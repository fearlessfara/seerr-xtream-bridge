import { z } from 'zod';

/** Playable browse leaf (stream / series entry). */
export const XtreamBrowseItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    source_id: z.string(),
    source_name: z.string().optional(),
    // Nested grouped leaves often omit name; inherit from parent group when flattening.
    name: z.string().optional(),
    group: z.string().optional(),
    content_type: z.string().optional(),
    tmdb_id: z.union([z.string(), z.number()]).nullable().optional(),
    container_extension: z.string().optional().nullable(),
    downloaded: z.boolean().optional(),
    rating: z.number().nullable().optional(),
    added: z.union([z.string(), z.number()]).nullable().optional(),
    icon: z.string().optional(),
  })
  .passthrough();

/** TMDb/title grouping wrapper used when browse returns grouped:true. */
export const XtreamBrowseGroupSchema = z
  .object({
    name: z.string(),
    items: z.array(XtreamBrowseItemSchema),
    count: z.number().optional(),
    tmdb_id: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .passthrough();

export const XtreamBrowseEntrySchema = z.union([XtreamBrowseGroupSchema, XtreamBrowseItemSchema]);

export const XtreamBrowseResponseSchema = z
  .object({
    items: z.array(XtreamBrowseEntrySchema).optional().default([]),
    // Live XtreamFilter returns boolean; older shapes may still use an array.
    grouped: z.union([z.boolean(), z.array(z.unknown())]).optional(),
    total: z.number().optional(),
    page: z.number().optional(),
    per_page: z.number().optional(),
    total_pages: z.number().optional(),
    content_type: z.string().optional(),
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
    name: z.string(),
    enabled: z.boolean().optional(),
    max_connections: z.number().optional(),
  })
  .passthrough();
