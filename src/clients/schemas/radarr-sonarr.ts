import { z } from 'zod';

export const ArrQualitySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    source: z.string().optional(),
    resolution: z.number().optional(),
    modifier: z.string().optional(),
  })
  .passthrough();

export const ArrQualityItemSchema: z.ZodType<{
  id?: number;
  name?: string | null;
  allowed: boolean;
  quality?: z.infer<typeof ArrQualitySchema> | null;
  items?: unknown[];
}> = z.lazy(() =>
  z
    .object({
      id: z.number().optional(),
      name: z.string().nullable().optional(),
      allowed: z.boolean(),
      quality: ArrQualitySchema.nullable().optional(),
      items: z.array(ArrQualityItemSchema).optional().default([]),
    })
    .passthrough(),
);

export const ArrQualityProfileSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    upgradeAllowed: z.boolean().optional(),
    cutoff: z.number().optional(),
    items: z.array(ArrQualityItemSchema).optional().default([]),
    minFormatScore: z.number().optional(),
    cutoffFormatScore: z.number().optional(),
    minUpgradeFormatScore: z.number().optional(),
    formatItems: z
      .array(
        z
          .object({
            format: z.number(),
            name: z.string(),
            score: z.number(),
          })
          .passthrough(),
      )
      .optional()
      .default([]),
    language: z
      .object({
        id: z.number(),
        name: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const ArrQualityProfileListSchema = z.array(ArrQualityProfileSchema);

export const ArrCustomFormatSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    specifications: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const ArrCustomFormatListSchema = z.array(ArrCustomFormatSchema);
