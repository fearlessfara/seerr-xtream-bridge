import { describe, expect, it } from 'vitest';
import {
  buildFfprobeArgs,
  buildXtreamVodProxyUrl,
  parseFfprobeOutput,
  redactProbeUrl,
  XtreamMediaProbe,
  type FfprobeExecutor,
} from '../../src/services/xtream-media-probe.js';
import { classifyResolutionFromDims } from '../../src/domain/quality/resolution.js';
import {
  evaluateCandidateQuality,
  pickBestCompatible,
} from '../../src/domain/quality/evaluator.js';
import { mergeProbeIntoQuality } from '../../src/domain/quality/probe-merge.js';
import { parseXtreamQuality } from '../../src/domain/quality/parser.js';
import { buildProbeShortlist } from '../../src/domain/quality/shortlist.js';
import { normalizeArrProfile } from '../../src/domain/quality/resolver.js';
import { ArrQualityProfileSchema } from '../../src/clients/schemas/radarr-sonarr.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MatchCandidate } from '../../src/domain/matching/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function hdProfile() {
  const raw = JSON.parse(
    readFileSync(join(root, 'fixtures/radarr/qualityprofile-hd.json'), 'utf8'),
  );
  return normalizeArrProfile({
    source: 'radarr',
    serverId: 0,
    profile: ArrQualityProfileSchema.parse(raw) as Parameters<
      typeof normalizeArrProfile
    >[0]['profile'],
  });
}

const sample1080 = {
  streams: [
    {
      index: 0,
      codec_name: 'h264',
      codec_type: 'video',
      width: 1920,
      height: 1080,
    },
    {
      index: 1,
      codec_name: 'aac',
      codec_type: 'audio',
      channels: 2,
      tags: { language: 'eng' },
    },
  ],
  format: {
    duration: '6512.361500',
    bit_rate: '3156487',
  },
};

describe('ffprobe parse + resolution', () => {
  it('parses successful 1080p probe JSON', () => {
    const result = parseFfprobeOutput(JSON.stringify(sample1080));
    expect(result.ok).toBe(true);
    expect(result.video?.width).toBe(1920);
    expect(result.video?.height).toBe(1080);
    expect(result.video?.codec).toBe('h264');
    expect(result.audioTracks[0]?.codec).toBe('aac');
    expect(result.audioTracks[0]?.channels).toBe(2);
    expect(result.audioTracks[0]?.language).toBe('en');
    expect(result.durationSeconds).toBeCloseTo(6512.3615);
    expect(result.formatBitrate).toBe(3156487);
    expect(result.resolution).toBe(1080);
  });

  it('classifies cropped cinema 1080-ish heights', () => {
    expect(classifyResolutionFromDims(1920, 804)).toBe(1080);
    expect(classifyResolutionFromDims(3840, 2160)).toBe(2160);
    expect(classifyResolutionFromDims(1280, 720)).toBe(720);
  });
});

describe('proxy URL construction', () => {
  it('uses container_extension mkv and source route, never .ts by default', () => {
    const url = buildXtreamVodProxyUrl({
      baseUrl: 'http://gluetun:5000',
      sourceRoute: 'strong',
      streamId: '1834468',
      containerExtension: 'mkv',
    });
    expect(url).toBe('http://gluetun:5000/strong/movie/user/pass/1834468.mkv');
    expect(url).not.toContain('.ts');
    expect(redactProbeUrl(url)).toBe('http://gluetun:5000/strong/movie/***/***/1834468.mkv');
  });

  it('rejects reserved / invalid routes', () => {
    expect(() =>
      buildXtreamVodProxyUrl({
        baseUrl: 'http://x',
        sourceRoute: 'merged',
        streamId: '1',
        containerExtension: 'mkv',
      }),
    ).toThrow(/Invalid XtreamFilter source route/);
  });

  it('includes expected ffprobe args', () => {
    const args = buildFfprobeArgs('http://gluetun:5000/strong/movie/user/pass/1834468.mkv');
    expect(args).toContain('-show_entries');
    expect(args).toContain('-of');
    expect(args).toContain('json');
    expect(args.at(-1)).toBe('http://gluetun:5000/strong/movie/user/pass/1834468.mkv');
  });
});

describe('quality evaluation with probe', () => {
  it('accepts probed 1080p for HD profile and rejects probed 2160p', () => {
    const profile = hdProfile();
    const ok = evaluateCandidateQuality({
      profile,
      observed: mergeProbeIntoQuality(
        parseXtreamQuality({ name: 'EN - Zootopia' }),
        parseFfprobeOutput(JSON.stringify(sample1080)),
      ),
      policy: 'allow',
      requireProbeEvidence: true,
      preferredLanguages: ['en'],
    });
    expect(ok.compatible).toBe(true);

    const uhdProbe = parseFfprobeOutput(
      JSON.stringify({
        ...sample1080,
        streams: [
          { index: 0, codec_name: 'hevc', codec_type: 'video', width: 3840, height: 2160 },
          sample1080.streams[1],
        ],
      }),
    );
    const bad = evaluateCandidateQuality({
      profile,
      observed: mergeProbeIntoQuality(parseXtreamQuality({ name: 'EN - Zootopia' }), uhdProbe),
      policy: 'allow',
      requireProbeEvidence: true,
      preferredLanguages: ['en'],
    });
    expect(bad.compatible).toBe(false);
  });

  it('does not allow unprobed candidates even with QUALITY_UNKNOWN_POLICY=allow', () => {
    const profile = hdProfile();
    const evaled = evaluateCandidateQuality({
      profile,
      observed: parseXtreamQuality({ name: 'KU - Zootopia (2016)' }),
      policy: 'allow',
      requireProbeEvidence: true,
      preferredLanguages: ['en'],
    });
    expect(evaled.compatible).toBe(false);
  });

  it('prefers EN over KU/DE/TR via language ranking', () => {
    const profile = hdProfile();
    const withAudio = (lang: string) =>
      parseFfprobeOutput(
        JSON.stringify({
          ...sample1080,
          streams: [sample1080.streams[0], { ...sample1080.streams[1], tags: { language: lang } }],
        }),
      );
    const items = [
      {
        evaluation: evaluateCandidateQuality({
          profile,
          observed: mergeProbeIntoQuality(
            parseXtreamQuality({ name: 'KU - Zootopia (2016)' }),
            withAudio('kur'),
          ),
          policy: 'allow',
          requireProbeEvidence: true,
          preferredLanguages: ['en'],
        }),
        tieKey: 'ku',
      },
      {
        evaluation: evaluateCandidateQuality({
          profile,
          observed: mergeProbeIntoQuality(
            parseXtreamQuality({ name: 'EN - Zootopia (2016)' }),
            withAudio('eng'),
          ),
          policy: 'allow',
          requireProbeEvidence: true,
          preferredLanguages: ['en'],
        }),
        tieKey: 'en',
      },
      {
        evaluation: evaluateCandidateQuality({
          profile,
          observed: mergeProbeIntoQuality(
            parseXtreamQuality({ name: 'DE - Zoomania' }),
            withAudio('deu'),
          ),
          policy: 'allow',
          requireProbeEvidence: true,
          preferredLanguages: ['en'],
        }),
        tieKey: 'de',
      },
    ];
    expect(pickBestCompatible(items)?.tieKey).toBe('en');
  });

  it('lets audio language override weaker filename inference', () => {
    const profile = hdProfile();
    const deNameEnAudio = mergeProbeIntoQuality(
      parseXtreamQuality({ name: 'DE - Zoomania' }),
      parseFfprobeOutput(JSON.stringify(sample1080)),
    );
    const evaled = evaluateCandidateQuality({
      profile,
      observed: deNameEnAudio,
      policy: 'allow',
      requireProbeEvidence: true,
      preferredLanguages: ['en'],
    });
    expect(evaled.compatible).toBe(true);
    expect(evaled.languageScore).toBeGreaterThan(9000);
    expect(evaled.reasons.some((r) => r.includes('audio language en'))).toBe(true);
  });
});

describe('shortlist + sequential probe', () => {
  it('enforces max probe count and language-first shortlist', () => {
    const profile = hdProfile();
    const candidates: MatchCandidate[] = [
      cand('1', 'KU - Zootopia'),
      cand('2', 'DE - Zoomania'),
      cand('3', 'EN - Zootopia'),
      cand('4', 'TR - Zootopia'),
      cand('5', 'Zootopia untitled'),
      cand('6', 'NF - Zootopia'),
      cand('7', 'D+ - Zootopia'),
    ];
    const shortlist = buildProbeShortlist({
      candidates,
      preferredLanguages: ['en'],
      profile,
      maxProbes: 3,
    });
    expect(shortlist).toHaveLength(3);
    expect(shortlist[0]?.candidate.streamId).toBe('3');
    expect(shortlist.map((s) => s.candidate.streamId)).not.toContain('1');
    expect(shortlist.map((s) => s.candidate.streamId)).not.toContain('2');
  });

  it('runs probes sequentially, respects timeout, and continues after failures', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const started: string[] = [];
    const executor: FfprobeExecutor = async (_b, args) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      const url = args.at(-1) ?? '';
      started.push(url);
      try {
        if (url.includes('1111')) {
          return { code: null, stdout: '', stderr: 'killed', timedOut: true };
        }
        if (url.includes('2222')) {
          return { code: 1, stdout: '', stderr: 'HTTP 502', timedOut: false };
        }
        return {
          code: 0,
          stdout: JSON.stringify(sample1080),
          stderr: 'Unexpected BlockAdditions',
          timedOut: false,
        };
      } finally {
        concurrent -= 1;
      }
    };

    const probe = new XtreamMediaProbe(
      {
        XTREAMFILTER_URL: 'http://xtream.test',
        FFPROBE_PATH: 'ffprobe',
        XTREAM_PROBE_TIMEOUT_MS: 40,
      },
      executor,
    );

    const a = await probe.probeVodCandidate({
      sourceRoute: 'strong',
      streamId: '1111',
      containerExtension: 'mkv',
    });
    expect(a.outcome.ok).toBe(false);
    if (!a.outcome.ok) expect(a.outcome.reason).toBe('ffprobe_timeout');

    const b = await probe.probeVodCandidate({
      sourceRoute: 'strong',
      streamId: '2222',
      containerExtension: 'mkv',
    });
    expect(b.outcome.ok).toBe(false);

    const c = await probe.probeVodCandidate({
      sourceRoute: 'strong',
      streamId: '1834468',
      containerExtension: 'mkv',
    });
    expect(c.outcome.ok).toBe(true);
    expect(started.every((u) => u.endsWith('.mkv'))).toBe(true);
    expect(started.some((u) => u.includes('/strong/movie/'))).toBe(true);
    expect(maxConcurrent).toBe(1);
  });

  it('guards against concurrent probeUrl calls', async () => {
    const executor: FfprobeExecutor = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { code: 0, stdout: JSON.stringify(sample1080), stderr: '', timedOut: false };
    };
    const probe = new XtreamMediaProbe(
      {
        XTREAMFILTER_URL: 'http://xtream.test',
        FFPROBE_PATH: 'ffprobe',
        XTREAM_PROBE_TIMEOUT_MS: 1000,
      },
      executor,
    );
    const url = probe.buildVodUrl({
      sourceRoute: 'strong',
      streamId: '1',
      containerExtension: 'mkv',
    });
    const p1 = probe.probeUrl(url);
    const p2 = probe.probeUrl(url);
    const [r1, r2] = await Promise.all([p1, p2]);
    const outcomes = [r1, r2];
    expect(outcomes.filter((o) => o.ok).length).toBe(1);
    expect(outcomes.some((o) => !o.ok && o.reason === 'probe_concurrency_guard')).toBe(true);
  });
});

function cand(id: string, name: string): MatchCandidate {
  return {
    sourceId: 'c31fa59e',
    sourceName: 'Strong 8K',
    streamId: id,
    name,
    contentType: 'vod',
    tmdbId: '269149',
    containerExtension: 'mkv',
  };
}
