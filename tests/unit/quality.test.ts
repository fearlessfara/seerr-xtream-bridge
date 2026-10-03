import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  evaluateCandidateQuality,
  pickBestCompatible,
} from '../../src/domain/quality/evaluator.js';
import { parseXtreamQuality } from '../../src/domain/quality/parser.js';
import { normalizeArrProfile } from '../../src/domain/quality/resolver.js';
import { ArrQualityProfileSchema } from '../../src/clients/schemas/radarr-sonarr.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadProfile() {
  const raw = JSON.parse(
    readFileSync(join(root, 'fixtures/radarr/qualityprofile-hd.json'), 'utf8'),
  );
  const parsed = ArrQualityProfileSchema.parse(raw);
  return normalizeArrProfile({
    source: 'radarr',
    serverId: 0,
    profile: parsed as Parameters<typeof normalizeArrProfile>[0]['profile'],
  });
}

describe('quality parser', () => {
  it('parses resolution and codec from title', () => {
    const q = parseXtreamQuality({ name: 'Dune 2021 1080p HEVC' });
    expect(q.resolution).toBe(1080);
    expect(q.codec).toBe('hevc');
    expect(q.confidence).not.toBe('unknown');
  });

  it('does not invent source for bare titles', () => {
    const q = parseXtreamQuality({ name: 'Dune 2021' });
    expect(q.source).toBeUndefined();
    expect(q.resolution).toBeUndefined();
  });
});

describe('quality resolver/evaluator', () => {
  it('resolves radarr profile allowed resolutions', () => {
    const profile = loadProfile();
    expect(profile.name).toBe('HD Bluray + WEB');
    expect(profile.observableConstraints.allow1080p).toBe(true);
    expect(profile.observableConstraints.allow2160p).toBe(false);
  });

  it('accepts 1080p and rejects 2160p for HD profile', () => {
    const profile = loadProfile();
    const ok = evaluateCandidateQuality({
      profile,
      observed: parseXtreamQuality({ name: 'Dune 2021 1080p' }),
      policy: 'allow',
    });
    const bad = evaluateCandidateQuality({
      profile,
      observed: parseXtreamQuality({ name: 'Dune 2021 2160p HDR' }),
      policy: 'allow',
    });
    expect(ok.compatible).toBe(true);
    expect(bad.compatible).toBe(false);
  });

  it('strict policy rejects unknown source', () => {
    const profile = loadProfile();
    const strict = evaluateCandidateQuality({
      profile,
      observed: parseXtreamQuality({ name: 'Dune 2021 1080p' }),
      policy: 'strict',
    });
    expect(strict.compatible).toBe(false);
    expect(strict.unknowns).toContain('source');
  });

  it('allow policy keeps unknown source when resolution ok', () => {
    const profile = loadProfile();
    const allow = evaluateCandidateQuality({
      profile,
      observed: parseXtreamQuality({ name: 'Dune 2021 1080p' }),
      policy: 'allow',
    });
    expect(allow.compatible).toBe(true);
  });

  it('picks deterministic preferred candidate', () => {
    const profile = loadProfile();
    const items = [
      {
        evaluation: evaluateCandidateQuality({
          profile,
          observed: parseXtreamQuality({ name: 'A 720p' }),
          policy: 'allow',
        }),
        tieKey: 'b',
      },
      {
        evaluation: evaluateCandidateQuality({
          profile,
          observed: parseXtreamQuality({ name: 'B 1080p' }),
          policy: 'allow',
        }),
        tieKey: 'a',
      },
      {
        evaluation: evaluateCandidateQuality({
          profile,
          observed: parseXtreamQuality({ name: 'C 1080p WEB-DL' }),
          policy: 'allow',
        }),
        tieKey: 'c',
      },
    ];
    const best = pickBestCompatible(items);
    expect(best?.tieKey).toBe('c');
  });
});
