import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { flattenBrowseItems } from '../../src/clients/xtreamfilter.js';
import { XtreamBrowseResponseSchema } from '../../src/clients/schemas/xtreamfilter.js';
import { matchMedia } from '../../src/domain/matching/matcher.js';
import {
  evaluateCandidateQuality,
  pickBestCompatible,
} from '../../src/domain/quality/evaluator.js';
import { parseXtreamQuality } from '../../src/domain/quality/parser.js';
import { normalizeArrProfile } from '../../src/domain/quality/resolver.js';
import { ArrQualityProfileSchema } from '../../src/clients/schemas/radarr-sonarr.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('XtreamFilter grouped browse parsing', () => {
  it('parses grouped:true boolean and flattens nested items', () => {
    const raw = JSON.parse(
      readFileSync(join(root, 'fixtures/xtreamfilter/browse-zootopia-grouped.json'), 'utf8'),
    );
    const parsed = XtreamBrowseResponseSchema.parse(raw);
    expect(parsed.grouped).toBe(true);

    const flat = flattenBrowseItems(parsed);
    expect(flat).toHaveLength(5);
    expect(flat.every((c) => c.contentType === 'vod')).toBe(true);
    expect(flat.every((c) => String(c.tmdbId) === '269149')).toBe(true);
    expect(flat.map((c) => c.streamId)).toEqual(
      expect.arrayContaining(['70261', '70262', '70263', '70264', '70265']),
    );
  });

  it('inherits group name when leaf omits name (DE - Zoomania)', () => {
    const raw = JSON.parse(
      readFileSync(join(root, 'fixtures/xtreamfilter/browse-zootopia-grouped.json'), 'utf8'),
    );
    const flat = flattenBrowseItems(XtreamBrowseResponseSchema.parse(raw));
    const nameless = flat.find((c) => c.streamId === '70261');
    expect(nameless?.name).toContain('DE - Zoomania');
  });

  it('still supports ungrouped flat items[]', () => {
    const raw = JSON.parse(
      readFileSync(join(root, 'fixtures/xtreamfilter/browse-movie.json'), 'utf8'),
    );
    const flat = flattenBrowseItems(XtreamBrowseResponseSchema.parse(raw));
    expect(flat).toHaveLength(2);
    expect(flat.map((c) => c.streamId)).toEqual(['9001', '9002']);
  });

  it('does not select the first grouped variant; quality eval prefers HD over DE/4K', () => {
    const raw = JSON.parse(
      readFileSync(join(root, 'fixtures/xtreamfilter/browse-zootopia-grouped.json'), 'utf8'),
    );
    const flat = flattenBrowseItems(XtreamBrowseResponseSchema.parse(raw));
    const match = matchMedia({
      tmdbId: 269149,
      contentType: 'vod',
      preferredSourceName: 'Strong 8K',
      candidates: flat,
    });
    expect(match.kind).toBe('EXACT_ID');
    expect(match.candidates.length).toBeGreaterThan(1);

    const profile = normalizeArrProfile({
      source: 'radarr',
      serverId: 0,
      profile: ArrQualityProfileSchema.parse(
        JSON.parse(readFileSync(join(root, 'fixtures/radarr/qualityprofile-hd.json'), 'utf8')),
      ) as Parameters<typeof normalizeArrProfile>[0]['profile'],
    });

    const evaluated = match.candidates.map((c) => ({
      candidate: c,
      evaluation: evaluateCandidateQuality({
        profile,
        observed: parseXtreamQuality({ name: c.name, containerExtension: c.containerExtension }),
        policy: 'allow' as const,
      }),
      tieKey: `${c.sourceId}:${c.streamId}`,
    }));

    const best = pickBestCompatible(evaluated);
    expect(best).toBeTruthy();
    // Must not blindly take the first nested leaf (DE - Zoomania / 70261)
    expect(best!.candidate.streamId).not.toBe('70261');
    // 2160p is disallowed by HD profile
    expect(best!.candidate.streamId).not.toBe('70263');
    // Prefer an explicit 1080p WEB/HEVC candidate
    expect(['70262', '70265']).toContain(best!.candidate.streamId);
  });
});
