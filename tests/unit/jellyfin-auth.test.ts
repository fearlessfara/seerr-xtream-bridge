import { describe, expect, it } from 'vitest';
import { JellyfinClient } from '../../src/clients/jellyfin.js';
import type { AppConfig } from '../../src/config.js';

describe('JellyfinClient auth header', () => {
  it('sends MediaBrowser Authorization, not X-Emby-Token', async () => {
    let seenAuth: string | null = null;
    let seenEmby: string | null = null;

    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenAuth = headers.get('authorization');
      seenEmby = headers.get('x-emby-token');
      return new Response(JSON.stringify({ ServerName: 'JF', Version: '12.1.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new JellyfinClient(
      {
        JELLYFIN_URL: 'http://jellyfin.test',
        JELLYFIN_API_KEY: 'test-key',
        HTTP_TIMEOUT_MS: 5000,
      } as AppConfig,
      fetchImpl,
    );

    await client.ping();

    expect(seenAuth).toBe('MediaBrowser Token="test-key"');
    expect(seenEmby).toBeNull();
  });
});
