import type { AppConfig } from '../config.js';
import { HttpClient } from '../lib/http.js';
import {
  JellyfinItemsResponseSchema,
  JellyfinSystemInfoSchema,
  type JellyfinItemSchema,
} from './schemas/jellyfin.js';
import type { z } from 'zod';

export type JellyfinItem = z.infer<typeof JellyfinItemSchema>;

/** Exact TMDb identity — never trust Jellyfin server-side AnyProviderIdEquals alone. */
export function itemMatchesTmdb(item: JellyfinItem, tmdbId: number): boolean {
  const providers = item.ProviderIds ?? {};
  const raw = providers.Tmdb ?? providers.TmdbId ?? providers.TheMovieDb;
  if (raw == null || raw === '') return false;
  return String(raw).replace(/^tmdb:/i, '') === String(tmdbId);
}

/** Prefer evidence of local/playable media, not a metadata-only stub. */
export function hasPlayableMedia(item: JellyfinItem): boolean {
  if (typeof item.Path === 'string' && item.Path.trim().length > 0) return true;
  const sources = item.MediaSources ?? [];
  return sources.some((s) => typeof s.Path === 'string' && s.Path.trim().length > 0);
}

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

  /**
   * Query Jellyfin for TMDb candidates, then locally filter to exact ProviderIds.Tmdb matches.
   * Server-side AnyProviderIdEquals is an optimization only — Jellyfin 12 may ignore it.
   */
  async findByTmdb(tmdbId: number, itemTypes?: string[]): Promise<JellyfinItem[]> {
    const { data } = await this.http.request('GET', '/Items', {
      query: {
        Recursive: true,
        // Optimization hint only — results are always identity-filtered locally.
        AnyProviderIdEquals: `Tmdb.${tmdbId}`,
        IncludeItemTypes: itemTypes?.join(','),
        Fields: 'ProviderIds,Path,MediaSources',
      },
      schema: JellyfinItemsResponseSchema,
    });

    const matched = (data.Items ?? []).filter((item): item is JellyfinItem =>
      itemMatchesTmdb(item as JellyfinItem, tmdbId),
    );

    const seen = new Set<string>();
    const unique: JellyfinItem[] = [];
    for (const item of matched) {
      if (seen.has(item.Id)) continue;
      seen.add(item.Id);
      unique.push(item);
    }
    return unique;
  }

  async getSeriesEpisodes(seriesId: string): Promise<JellyfinItem[]> {
    const { data } = await this.http.request(
      'GET',
      `/Shows/${encodeURIComponent(seriesId)}/Episodes`,
      {
        query: { Fields: 'ProviderIds,Path,MediaSources' },
        schema: JellyfinItemsResponseSchema,
      },
    );
    return (data.Items ?? []) as JellyfinItem[];
  }

  async movieExists(tmdbId: number): Promise<boolean> {
    const items = await this.findByTmdb(tmdbId, ['Movie']);
    return items.some(
      (i) => i.Type === 'Movie' && itemMatchesTmdb(i, tmdbId) && hasPlayableMedia(i),
    );
  }

  async tvSeasonsPresent(
    tmdbId: number,
    seasons: number[],
  ): Promise<{ present: boolean; seriesId?: string; missing: number[]; episodeGaps: string[] }> {
    const series = (await this.findByTmdb(tmdbId, ['Series'])).filter(
      (i) => i.Type === 'Series' && itemMatchesTmdb(i, tmdbId),
    );
    if (!series.length) {
      return { present: false, missing: [...seasons], episodeGaps: ['series not found'] };
    }

    // Prefer a series row that has playable evidence when available; otherwise first exact match.
    const seriesItem = series.find((s) => hasPlayableMedia(s)) ?? series[0];
    const seriesId = seriesItem.Id;
    const episodes = await this.getSeriesEpisodes(seriesId);
    const missing: number[] = [];
    const episodeGaps: string[] = [];

    for (const season of seasons) {
      const eps = episodes.filter(
        (e) => e.ParentIndexNumber === season && (e.IndexNumber ?? 0) > 0 && hasPlayableMedia(e),
      );
      if (!eps.length) {
        missing.push(season);
        episodeGaps.push(`season ${season}: no playable episodes`);
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
