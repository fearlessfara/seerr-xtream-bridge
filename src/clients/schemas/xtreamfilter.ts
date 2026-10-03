import { z } from 'zod';

/** Playable browse leaf (stream / series entry). */
export const XtreamBrowseItemSchema = z
  .object({
    name: z.string().optional(),
    group: z.string().optional(),
    icon: z.string().optional().nullable(),
    id: z.union([z.string(), z.number()]),
    source_id: z.string(),
    source_name: z.string().optional(),
    added: z.union([z.string(), z.number()]).optional().nullable(),
    rating: z.number().optional().nullable(),
    content_type: z.enum(['vod', 'series']).or(z.string()),
    tmdb_id: z.union([z.string(), z.number()]).optional().nullable(),
    container_extension: z.string().optional().nullable(),
    downloaded: z.boolean().optional(),
    categories: z.array(z.unknown()).optional(),
  })
  .passthrough();

/** TMDb/title grouping wrapper returned when browse is grouped. */
export const XtreamBrowseGroupSchema = z
  .object({
    name: z.string(),
    icon: z.string().optional().nullable(),
    items: z.array(XtreamBrowseItemSchema),
    count: z.number().optional(),
    rating: z.number().optional().nullable(),
    added: z.union([z.string(), z.number()]).optional().nullable(),
    tmdb_id: z.union([z.string(), z.number()]).optional().nullable(),
    downloaded: z.boolean().optional(),
  })
  .passthrough();

export const XtreamBrowseResponseSchema = z
  .object({
    // Group first: leaf schema is passthrough and would otherwise accept nested `items`.
    items: z.array(z.union([XtreamBrowseGroupSchema, XtreamBrowseItemSchema])).default([]),
    grouped: z.boolean().optional(),
    total: z.number().optional(),
    page: z.number().optional(),
    per_page: z.number().optional(),
    total_pages: z.number().optional(),
    content_type: z.string().optional(),
    // metadata returned by current XtreamFilter
    groups: z.array(z.unknown()).optional(),
    sources: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const XtreamCartItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    stream_id: z.union([z.string(), z.number()]).optional(),
    source_id: z.string(),
    content_type: z.string(),
    name: z.string().optional(),
    series_id: z.union([z.string(), z.number()]).optional().nullable(),
    series_name: z.string().optional().nullable(),
    season: z.union([z.string(), z.number()]).optional().nullable(),
    episode_num: z.union([z.string(), z.number()]).optional().nullable(),
    status: z.string().optional(),
    progress: z.number().optional(),
    container_extension: z.string().optional(),
  })
  .passthrough();

export const XtreamCartListSchema = z
  .object({
    items: z.array(XtreamCartItemSchema).default([]),
  })
  .passthrough();

export const XtreamCartStatusSchema = z
  .object({
    is_running: z.boolean().optional(),
    queued: z.number().optional(),
    downloading: z.number().optional(),
    completed: z.number().optional(),
    failed: z.number().optional(),
    total: z.number().optional(),
  })
  .passthrough();

export const XtreamEpisodeSchema = z
  .object({
    stream_id: z.union([z.string(), z.number()]),
    season: z.union([z.string(), z.number()]),
    episode_num: z.union([z.string(), z.number()]),
    title: z.string().optional(),
    container_extension: z.string().optional(),
    series_name: z.string().optional(),
  })
  .passthrough();

export const XtreamSeriesEpisodesSchema = z
  .object({
    series_name: z.string().optional().default(''),
    seasons: z.record(z.array(XtreamEpisodeSchema)).default({}),
    total_episodes: z.number().optional(),
  })
  .passthrough();

export const XtreamSourceSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    /** XtreamFilter dedicated proxy route slug (e.g. "strong"). */
    route: z.string().optional().nullable(),
    prefix: z.string().optional().nullable(),
    max_connections: z.number().optional(),
  })
  .passthrough();

export const XtreamSourcesResponseSchema = z.union([
  z.array(XtreamSourceSchema),
  z
    .object({
      sources: z.array(XtreamSourceSchema).default([]),
    })
    .passthrough(),
]);
