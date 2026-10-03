import { z } from 'zod';

export const JellyfinMediaSourceSchema = z
  .object({
    Id: z.string().optional(),
    Path: z.string().optional(),
    Type: z.string().optional(),
    Protocol: z.string().optional(),
  })
  .passthrough();

export const JellyfinItemSchema = z
  .object({
    Id: z.string(),
    Name: z.string().optional(),
    Type: z.string().optional(),
    Path: z.string().optional().nullable(),
    ProviderIds: z.record(z.string()).optional().default({}),
    MediaSources: z.array(JellyfinMediaSourceSchema).optional(),
    ProductionYear: z.number().optional(),
    IndexNumber: z.number().optional(),
    ParentIndexNumber: z.number().optional(),
    SeriesName: z.string().optional(),
    ChildCount: z.number().optional(),
  })
  .passthrough();

export const JellyfinItemsResponseSchema = z
  .object({
    Items: z.array(JellyfinItemSchema).default([]),
    TotalRecordCount: z.number().optional(),
  })
  .passthrough();

export const JellyfinSystemInfoSchema = z
  .object({
    ServerName: z.string().optional(),
    Version: z.string().optional(),
    Id: z.string().optional(),
  })
  .passthrough();
