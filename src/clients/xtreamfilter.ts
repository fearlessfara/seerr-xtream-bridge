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

function flattenBrowseItems(data: z.infer<typeof XtreamBrowseResponseSchema>): MatchCandidate[] {
  const out: MatchCandidate[] = [];

  const pushItem = (raw: unknown, contentTypeHint?: string) => {
    const parsed = XtreamBrowseItemSchema.safeParse(raw);
    if (!parsed.success) return;
    const item = parsed.data;
    const ct = (item.content_type ?? contentTypeHint ?? '').toLowerCase();
    const contentType = ct === 'series' ? 'series' : ct === 'vod' ? 'vod' : undefined;
    if (!contentType) return;
    out.push({
      sourceId: item.source_id,
      sourceName: item.source_name,
      streamId: contentType === 'vod' ? String(item.id) : undefined,
      seriesId: contentType === 'series' ? String(item.id) : undefined,
      name: item.name,
      tmdbId: item.tmdb_id,
      contentType,
      containerExtension: item.container_extension,
      raw: item,
    });
  };

  for (const item of data.items ?? []) {
    if (item && typeof item === 'object' && 'items' in (item as object)) {
      const group = item as { name?: string; items?: unknown[] };
      for (const sub of group.items ?? []) pushItem(sub);
    } else {
      pushItem(item);
    }
  }

  if (data.grouped) {
    for (const g of data.grouped) {
      if (g && typeof g === 'object' && 'items' in (g as object)) {
        for (const sub of (g as { items?: unknown[] }).items ?? []) pushItem(sub);
      }
    }
  }

  return out;
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
