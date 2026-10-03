import type { AppConfig } from '../config.js';
import { HttpClient } from '../lib/http.js';
import {
  JellyfinItemsResponseSchema,
  JellyfinSystemInfoSchema,
  type JellyfinItemSchema,
} from './schemas/jellyfin.js';
import type { z } from 'zod';

type JellyfinItem = z.infer<typeof JellyfinItemSchema>;

export class JellyfinClient {
  private readonly http: HttpClient;

  constructor(config: AppConfig, fetchImpl?: typeof fetch) {
    this.http = new HttpClient({
      baseUrl: config.JELLYFIN_URL,
      timeoutMs: config.HTTP_TIMEOUT_MS,
      serviceName: 'jellyfin',
      fetchImpl,
      // Jellyfin 10.9+/12.x reject legacy X-Emby-Token; use MediaBrowser Authorization.
      defaultHeaders: {
        Authorization: `MediaBrowser Token="${config.JELLYFIN_API_KEY}"`,
      },
    });
  }

  async ping() {
    const { data } = await this.http.request('GET', '/System/Info', {
      schema: JellyfinSystemInfoSchema,
    });
    return data;
  }

  async refreshLibrary() {
    await this.http.request('POST', '/Library/Refresh', { allowStatuses: [200, 204] });
  }

  async findByTmdb(tmdbId: number, itemTypes?: string[]): Promise<JellyfinItem[]> {
    const attempts = [`Tmdb.${tmdbId}`, `Tmdb.${tmdbId}`, `TheMovieDb.${tmdbId}`, String(tmdbId)];
    const found: JellyfinItem[] = [];
    const seen = new Set<string>();

    for (const key of [...new Set(attempts)]) {
      const { data } = await this.http.request('GET', '/Items', {
        query: {
          Recursive: true,
          AnyProviderIdEquals: key,
          IncludeItemTypes: itemTypes?.join(','),
          Fields: 'ProviderIds',
        },
        schema: JellyfinItemsResponseSchema,
      });
      for (const item of data.Items ?? []) {
        if (!seen.has(item.Id)) {
          seen.add(item.Id);
          found.push(item as JellyfinItem);
        }
      }
      if (found.length) break;
    }
    return found;
  }

  async getSeriesEpisodes(seriesId: string): Promise<JellyfinItem[]> {
    const { data } = await this.http.request(
      'GET',
      `/Shows/${encodeURIComponent(seriesId)}/Episodes`,
      {
        query: { Fields: 'ProviderIds' },
        schema: JellyfinItemsResponseSchema,
      },
    );
    return (data.Items ?? []) as JellyfinItem[];
  }

  async movieExists(tmdbId: number): Promise<boolean> {
    const items = await this.findByTmdb(tmdbId, ['Movie']);
    return items.some((i) => i.Type === 'Movie' || !i.Type);
  }

  async tvSeasonsPresent(
    tmdbId: number,
    seasons: number[],
  ): Promise<{ present: boolean; seriesId?: string; missing: number[]; episodeGaps: string[] }> {
    const series = (await this.findByTmdb(tmdbId, ['Series'])).filter(
      (i) => i.Type === 'Series' || !i.Type,
    );
    if (!series.length) {
      return { present: false, missing: [...seasons], episodeGaps: ['series not found'] };
    }
    const seriesId = series[0].Id;
    const episodes = await this.getSeriesEpisodes(seriesId);
    const missing: number[] = [];
    const episodeGaps: string[] = [];

    for (const season of seasons) {
      const eps = episodes.filter(
        (e) => e.ParentIndexNumber === season && (e.IndexNumber ?? 0) > 0,
      );
      if (!eps.length) {
        missing.push(season);
        episodeGaps.push(`season ${season}: no episodes`);
      }
    }

    return {
      present: missing.length === 0,
      seriesId,
      missing,
      episodeGaps,
    };
  }
}
