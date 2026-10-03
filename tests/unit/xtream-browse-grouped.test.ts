import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { flattenBrowseItems, XtreamFilterClient } from '../../src/clients/xtreamfilter.js';
import { XtreamBrowseResponseSchema } from '../../src/clients/schemas/xtreamfilter.js';
import { matchMedia } from '../../src/domain/matching/matcher.js';
import type { AppConfig } from '../../src/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    HOST: '0.0.0.0',
    PORT: 5056,
    LOG_LEVEL: 'silent',
    DATABASE_PATH: ':memory:',
    BRIDGE_API_KEY: '',
    SEERR_URL: 'http://seerr.test',
    SEERR_API_KEY: 'x',
    SEERR_WEBHOOK_SECRET: '',
    SEERR_AVAILABILITY_GRACE_SECONDS: 60,
    SEERR_REQUEST_COMPLETION_GRACE_SECONDS: 60,
    XTREAMFILTER_URL: 'http://xtream.test',
    XTREAMFILTER_SOURCE_ID: 'c31fa59e',
    XTREAMFILTER_SOURCE_NAME: 'Strong 8K',
    JELLYFIN_URL: 'http://jellyfin.test',
    JELLYFIN_API_KEY: 'x',
    RADARR_URL: '',
    RADARR_API_KEY: '',
    SONARR_URL: '',
    SONARR_API_KEY: '',
    RECONCILE_INTERVAL_SECONDS: 30,
    XTREAM_PARTIAL_POLICY: 'all_or_nothing',
    QUALITY_UNKNOWN_POLICY: 'allow',
    QUALITY_PROFILE_CACHE_TTL_SECONDS: 300,
    HTTP_TIMEOUT_MS: 5000,
    BODY_LIMIT_BYTES: 1_048_576,
    METRICS_REQUIRE_AUTH: false,
    ...overrides,
  };
}

describe('XtreamFilter grouped browse parsing', () => {
  it('flattens grouped XtreamFilter browse results', async () => {
    const payload = JSON.parse(
      readFileSync(join(root, 'fixtures/xtreamfilter/browse-zootopia-grouped.json'), 'utf8'),
    );

    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const client = new XtreamFilterClient(testConfig(), fetchImpl);
    const results = await client.browseByTmdb(269149, 'vod');

    expect(results).toHaveLength(6);
    expect(results.map((x) => x.streamId)).toEqual([
      '70261',
      '1834468',
      '70270',
      '70271',
      '70273',
      '70274',
    ]);
    expect(results.every((x) => String(x.tmdbId) === '269149')).toBe(true);
    expect(results.every((x) => x.sourceName === 'Strong 8K')).toBe(true);
  });

  it('still supports ungrouped flat items[]', async () => {
    const payload = JSON.parse(
      readFileSync(join(root, 'fixtures/xtreamfilter/browse-movie.json'), 'utf8'),
    );

    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const client = new XtreamFilterClient(testConfig(), fetchImpl);
    const results = await client.browseByTmdb(693134, 'vod');
    expect(results).toHaveLength(2);
    expect(results.map((x) => x.streamId)).toEqual(['9001', '9002']);
  });

  it('passes all flattened TMDb variants into matching (not just items[0])', () => {
    const parsed = XtreamBrowseResponseSchema.parse(
      JSON.parse(
        readFileSync(join(root, 'fixtures/xtreamfilter/browse-zootopia-grouped.json'), 'utf8'),
      ),
    );
    const flat = flattenBrowseItems(parsed);
    expect(flat).toHaveLength(6);

    const match = matchMedia({
      tmdbId: 269149,
      contentType: 'vod',
      preferredSourceName: 'Strong 8K',
      candidates: flat,
    });
    expect(match.kind).toBe('EXACT_ID');
    expect(match.candidates).toHaveLength(6);
    expect(match.candidates.map((c) => c.streamId)).toContain('1834468');
    expect(match.candidates.map((c) => c.name)).toContain('EN - Zootopia (2016)');
  });
});
