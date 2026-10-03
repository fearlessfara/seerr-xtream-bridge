import { z } from 'zod';

export const SeerrWebhookSchema = z
  .object({
    notification_type: z.string(),
    event: z.string().optional(),
    subject: z.string().optional(),
    message: z.string().optional(),
    media: z
      .object({
        media_type: z.enum(['movie', 'tv']).or(z.string()),
        tmdbId: z.union([z.string(), z.number()]).optional(),
        tvdbId: z.union([z.string(), z.number()]).optional().nullable(),
        status: z.union([z.string(), z.number()]).optional(),
        status4k: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .optional()
      .nullable(),
    request: z
      .object({
        request_id: z.union([z.string(), z.number()]),
        requestedBy_username: z.string().optional(),
        requestedBy_email: z.string().optional(),
      })
      .passthrough()
      .optional()
      .nullable(),
    extra: z
      .array(
        z
          .object({
            name: z.string(),
            value: z.string(),
          })
          .passthrough(),
      )
      .optional()
      .nullable(),
  })
  .passthrough();

export type SeerrWebhookPayload = z.infer<typeof SeerrWebhookSchema>;

export const SeerrSeasonSchema = z
  .object({
    id: z.number().optional(),
    seasonNumber: z.number(),
    status: z.number().optional(),
  })
  .passthrough();

export const SeerrMediaSchema = z
  .object({
    id: z.number(),
    tmdbId: z.number(),
    tvdbId: z.number().optional().nullable(),
    status: z.number(),
    status4k: z.number().optional(),
    mediaType: z.enum(['movie', 'tv']).or(z.string()),
    seasons: z.array(SeerrSeasonSchema).optional().default([]),
  })
  .passthrough();

export const SeerrRequestSchema = z
  .object({
    id: z.number(),
    status: z.number(),
    type: z.enum(['movie', 'tv']).or(z.string()),
    is4k: z.boolean().optional().default(false),
    serverId: z.number().nullable().optional(),
    profileId: z.number().nullable().optional(),
    rootFolder: z.string().nullable().optional(),
    languageProfileId: z.number().nullable().optional(),
    tags: z.array(z.number()).nullable().optional(),
    seasons: z.array(SeerrSeasonSchema).optional().default([]),
    media: SeerrMediaSchema,
    requestedBy: z
      .object({
        id: z.number().optional(),
        displayName: z.string().optional(),
        email: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type SeerrRequest = z.infer<typeof SeerrRequestSchema>;

export const SeerrArrSettingsSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    hostname: z.string(),
    port: z.number(),
    apiKey: z.string(),
    useSsl: z.boolean().optional(),
    baseUrl: z.string().optional().nullable(),
    isDefault: z.boolean().optional(),
    is4k: z.boolean().optional(),
    activeProfileId: z.number().optional(),
    activeDirectory: z.string().optional(),
    externalUrl: z.string().optional().nullable(),
  })
  .passthrough();

export const SeerrArrSettingsListSchema = z.array(SeerrArrSettingsSchema);
