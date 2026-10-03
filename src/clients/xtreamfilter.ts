import type { AppConfig } from '../config.js';
import { HttpClient } from '../lib/http.js';
import type { MatchCandidate } from '../domain/matching/types.js';
import {
  XtreamBrowseGroupSchema,
  XtreamBrowseItemSchema,
  XtreamBrowseResponseSchema,
  XtreamCartListSchema,
  XtreamCartStatusSchema,
  XtreamSeriesEpisodesSchema,
  XtreamSourceSchema,
} from './schemas/xtreamfilter.js';
import { z } from 'zod';

type BrowseItem = z.infer<typeof XtreamBrowseItemSchema>;

function toCandidate(item: BrowseItem, contentTypeHint?: string): MatchCandidate | undefined {
  const ct = (item.content_type ?? contentTypeHint ?? '').toLowerCase();
  const contentType = ct === 'series' ? 'series' : ct === 'vod' ? 'vod' : undefined;
  if (!contentType) return undefined;
  if (!item.name?.trim()) return undefined;

  return {
    sourceId: item.source_id,
    sourceName: item.source_name,
    streamId: contentType === 'vod' ? String(item.id) : undefined,
    seriesId: contentType === 'series' ? String(item.id) : undefined,
    name: item.name,
    tmdbId: item.tmdb_id,
    contentType,
    containerExtension: item.container_extension ?? undefined,
    raw: item,
  };
}

function isBrowseGroup(entry: unknown): entry is z.infer<typeof XtreamBrowseGroupSchema> {
  return XtreamBrowseGroupSchema.safeParse(entry).success;
}

/**
 * Flatten grouped or ungrouped /api/browse payloads into playable leaf candidates.
 * With grouped:true, items[] are TMDb/title groups and items[].items[] are variants.
 */
export function flattenBrowseItems(
  data: z.infer<typeof XtreamBrowseResponseSchema>,
): MatchCandidate[] {
  const out: MatchCandidate[] = [];

  const pushLeaf = (leaf: BrowseItem, groupName?: string, groupTmdb?: string | number | null) => {
    const merged: BrowseItem = {
      ...leaf,
      name: leaf.name?.trim() ? leaf.name : groupName,
      tmdb_id: leaf.tmdb_id ?? groupTmdb ?? null,
      // Keep language/quality tokens from the group title available to the quality parser.
      group: leaf.group ?? groupName,
    };
    // Prefer a display name that includes distinguishing group tokens when the leaf name
    // is missing or is a bare id-like stub; quality eval uses candidate.name.
    if (
      groupName &&
      leaf.name &&
      leaf.name !== groupName &&
      !/\b(4k|2160|1080|720|hdr|hevc|x265)\b/i.test(leaf.name)
    ) {
      merged.name = `${groupName} ${leaf.name}`.trim();
    } else if (groupName && !leaf.name?.trim()) {
      merged.name = groupName;
    }
    const candidate = toCandidate(merged);
    if (candidate) out.push(candidate);
  };

  for (const entry of data.items ?? []) {
    if (isBrowseGroup(entry)) {
      for (const leaf of entry.items) {
        pushLeaf(leaf, entry.name, entry.tmdb_id);
      }
      continue;
    }
    const leaf = XtreamBrowseItemSchema.safeParse(entry);
    if (leaf.success) pushLeaf(leaf.data);
  }

  // Legacy: grouped as an array of groups (not boolean).
  if (Array.isArray(data.grouped)) {
    for (const g of data.grouped) {
      const group = XtreamBrowseGroupSchema.safeParse(g);
      if (!group.success) continue;
      for (const leaf of group.data.items) {
        pushLeaf(leaf, group.data.name, group.data.tmdb_id);
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
