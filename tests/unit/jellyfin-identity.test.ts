import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasPlayableMedia, itemMatchesTmdb, JellyfinClient } from '../../src/clients/jellyfin.js';
import type { AppConfig } from '../../src/config.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'jellyfin');

function load(name: string) {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
}

function clientFor(handler: (url: string) => unknown) {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    return new Response(JSON.stringify(handler(url)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  return new JellyfinClient(
    {
      JELLYFIN_URL: 'http://jellyfin.test',
      JELLYFIN_API_KEY: 'key',
      HTTP_TIMEOUT_MS: 5000,
    } as AppConfig,
    fetchImpl,
  );
}

describe('Jellyfin TMDb identity helpers', () => {
  it('matches exact ProviderIds.Tmdb only', () => {
    expect(itemMatchesTmdb({ Id: '1', ProviderIds: { Tmdb: '335984' } }, 335984)).toBe(true);
    expect(itemMatchesTmdb({ Id: '1', ProviderIds: { Tmdb: '278' } }, 335984)).toBe(false);
    expect(itemMatchesTmdb({ Id: '1', ProviderIds: {} }, 335984)).toBe(false);
  });

  it('requires playable path/media source', () => {
    expect(hasPlayableMedia({ Id: '1', Path: '/media/film.mkv', ProviderIds: {} })).toBe(true);
    expect(
      hasPlayableMedia({
        Id: '1',
        ProviderIds: {},
        MediaSources: [{ Path: '/media/film.mkv' }],
      }),
    ).toBe(true);
    expect(hasPlayableMedia({ Id: '1', ProviderIds: { Tmdb: '335984' } })).toBe(false);
  });
});

describe('Jellyfin movieExists regression', () => {
  it('returns false when Jellyfin returns unrelated movies for TMDb 335984', async () => {
    const client = clientFor(() => load('movie-false-positive-335984.json'));
    await expect(client.movieExists(335984)).resolves.toBe(false);
    const found = await client.findByTmdb(335984, ['Movie']);
    expect(found).toEqual([]);
  });

  it('returns true when response contains exact ProviderIds.Tmdb=335984 with media', async () => {
    const client = clientFor(() => load('movie-blade-runner-exact.json'));
    await expect(client.movieExists(335984)).resolves.toBe(true);
    const found = await client.findByTmdb(335984, ['Movie']);
    expect(found).toHaveLength(1);
    expect(found[0].ProviderIds?.Tmdb).toBe('335984');
  });

  it('rejects metadata-only exact TMDb match without playable media', async () => {
    const client = clientFor(() => ({
      Items: [
        {
          Id: 'meta-only',
          Name: 'Blade Runner 2049',
          Type: 'Movie',
          ProviderIds: { Tmdb: '335984' },
        },
      ],
    }));
    await expect(client.movieExists(335984)).resolves.toBe(false);
  });
});

describe('Jellyfin tvSeasonsPresent regression', () => {
  it('returns false when only unrelated series are returned', async () => {
    const client = clientFor((url) => {
      if (url.includes('/Shows/')) return { Items: [] };
      return load('series-false-positive.json');
    });
    const result = await client.tvSeasonsPresent(95396, [2]);
    expect(result.present).toBe(false);
    expect(result.episodeGaps).toContain('series not found');
  });

  it('returns true when exact series TMDb matches and season episodes are playable', async () => {
    const client = clientFor((url) => {
      if (url.includes('/Shows/jf-severance/Episodes')) return load('series-episodes-s2.json');
      return load('series-exact.json');
    });
    const result = await client.tvSeasonsPresent(95396, [2]);
    expect(result.present).toBe(true);
    expect(result.seriesId).toBe('jf-severance');
    expect(result.missing).toEqual([]);
  });
});
