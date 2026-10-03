import { describe, expect, it } from 'vitest';
import { XtreamFilterClient } from '../../src/clients/xtreamfilter.js';
import type { AppConfig } from '../../src/config.js';

function cfg(): AppConfig {
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
    XTREAMFILTER_SOURCE_ID: '',
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
    XTREAM_PREFERRED_LANGUAGES: ['en'],
    XTREAM_MAX_CANDIDATE_PROBES: 5,
    XTREAM_PROBE_TIMEOUT_MS: 15_000,
    FFPROBE_PATH: 'ffprobe',
    HTTP_TIMEOUT_MS: 5000,
    BODY_LIMIT_BYTES: 1_048_576,
    METRICS_REQUIRE_AUTH: false,
  };
}

describe('XtreamFilter source route resolution', () => {
  it('resolves source_id to API route field (not display name)', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/api/sources')) {
        return new Response(
          JSON.stringify({
            sources: [
              { id: 'c31fa59e', name: 'Strong 8K', route: 'strong', enabled: true },
              { id: 'other', name: 'Other', route: 'providera', enabled: true },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    };
    const client = new XtreamFilterClient(cfg(), fetchImpl);
    await expect(client.resolveSourceRoute('c31fa59e')).resolves.toBe('strong');
    await expect(client.resolveSourceRoute('other')).resolves.toBe('providera');
    await expect(client.resolveSourceRoute('missing')).resolves.toBeUndefined();
  });
});
