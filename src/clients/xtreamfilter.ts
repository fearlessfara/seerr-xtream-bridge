import type { AppConfig } from '../config.js';
import { HttpClient } from '../lib/http.js';
import type { MatchCandidate } from '../domain/matching/types.js';
import {
  XtreamBrowseItemSchema,
  XtreamBrowseResponseSchema,
  XtreamCartListSchema,
  XtreamCartStatusSchema,
  XtreamSeriesEpisodesSchema,
  XtreamSourceSchema,
} from './schemas/xtreamfilter.js';
import { z } from 'zod';

type BrowseItem = z.infer<typeof XtreamBrowseItemSchema>;
type BrowseEntry = z.infer<typeof XtreamBrowseResponseSchema>['items'][number];

function isBrowseGroup(entry: BrowseEntry): entry is BrowseEntry & { items: BrowseItem[] } {
  return 'items' in entry && Array.isArray((entry as { items?: unknown }).items);
}

function toCandidate(
  item: BrowseItem,
  opts?: { groupName?: string; groupTmdb?: string | number | null },
): MatchCandidate | undefined {
  const ct = (item.content_type ?? '').toLowerCase();
  const contentType = ct === 'series' ? 'series' : ct === 'vod' ? 'vod' : undefined;
  if (!contentType) return undefined;

  const name = (item.name?.trim() ? item.name : opts?.groupName)?.trim();
  if (!name) return undefined;

  return {
    sourceId: item.source_id,
    sourceName: item.source_name,
    streamId: contentType === 'vod' ? String(item.id) : undefined,
    seriesId: contentType === 'series' ? String(item.id) : undefined,
    name,
    tmdbId: item.tmdb_id ?? opts?.groupTmdb ?? null,
    contentType,
    containerExtension: item.container_extension ?? undefined,
    raw: item,
  };
}

/**
 * Flatten grouped or ungrouped /api/browse payloads into playable leaf candidates.
 * With grouped:true, items[] are TMDb/title groups and items[].items[] are the variants.
 */
export function flattenBrowseItems(
  data: z.infer<typeof XtreamBrowseResponseSchema>,
): MatchCandidate[] {
  const leaves = data.items.flatMap((entry) => {
    if (isBrowseGroup(entry)) {
      return entry.items.map((leaf) =>
        toCandidate(leaf, {
          groupName: entry.name,
          groupTmdb: entry.tmdb_id ?? null,
        }),
      );
    }
    return [toCandidate(entry)];
  });

  return leaves.filter((c): c is MatchCandidate => c != null);
}

export class XtreamFilterClient {
  private readonly http: HttpClient;

  constructor(config: AppConfig, fetchImpl?: typeof fetch) {
    this.http = new HttpClient({
      baseUrl: config.XTREAMFILTER_URL,
      timeoutMs: config.HTTP_TIMEOUT_MS,
      serviceName: 'xtreamfilter',
      fetchImpl,
    });
  }

  async browseByTmdb(tmdbId: number, type?: 'vod' | 'series'): Promise<MatchCandidate[]> {
    const { data } = await this.http.request('GET', '/api/browse', {
      query: {
        search: `tmdb:${tmdbId}`,
        type: type ?? undefined,
        per_page: 0,
      },
      schema: XtreamBrowseResponseSchema,
    });
    return flattenBrowseItems(data as z.infer<typeof XtreamBrowseResponseSchema>).filter(
      (c) => !type || c.contentType === type,
    );
  }

  async getSeriesEpisodes(sourceId: string, seriesId: string) {
    const { data } = await this.http.request(
      'GET',
      `/api/cart/series-episodes/${encodeURIComponent(sourceId)}/${encodeURIComponent(seriesId)}`,
      { schema: XtreamSeriesEpisodesSchema },
    );
    return data;
  }

  async listCart() {
    const { data } = await this.http.request('GET', '/api/cart', { schema: XtreamCartListSchema });
    return data.items ?? [];
  }

  async cartStatus() {
    const { data } = await this.http.request('GET', '/api/cart/status', {
      schema: XtreamCartStatusSchema,
    });
    return data;
  }

  async startCart() {
    await this.http.request('POST', '/api/cart/start', { allowStatuses: [200, 201, 204] });
  }

  async addToCart(body: Record<string, unknown>): Promise<{ status: number; data: unknown }> {
    return this.http.request('POST', '/api/cart', {
      body,
      allowStatuses: [200, 201, 409],
    });
  }

  async listSources() {
    const { data } = await this.http.request('GET', '/api/sources', {
      schema: z.array(XtreamSourceSchema),
    });
    return data;
  }

  findCartMovie(
    items: z.infer<typeof XtreamCartListSchema>['items'],
    sourceId: string,
    streamId: string,
  ) {
    return items.find(
      (i) =>
        i.source_id === sourceId &&
        String(i.stream_id) === String(streamId) &&
        (i.content_type === 'vod' || i.content_type === 'movie'),
    );
  }

  findCartSeason(
    items: z.infer<typeof XtreamCartListSchema>['items'],
    sourceId: string,
    seriesId: string,
    season: number,
  ) {
    return items.filter(
      (i) =>
        i.source_id === sourceId &&
        String(i.series_id) === String(seriesId) &&
        Number(i.season) === season,
    );
  }
}
