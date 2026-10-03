import { z } from 'zod';

export const JellyfinItemSchema = z
  .object({
    Id: z.string(),
    Name: z.string().optional(),
    Type: z.string().optional(),
    ProviderIds: z.record(z.string()).optional().default({}),
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
