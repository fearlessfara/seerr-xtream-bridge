import { z } from 'zod';

export const FfprobeStreamSchema = z
  .object({
    index: z.number().optional(),
    codec_name: z.string().optional(),
    codec_type: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    bit_rate: z.union([z.string(), z.number()]).optional(),
    channels: z.number().optional(),
    tags: z
      .object({
        language: z.string().optional(),
        title: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const FfprobeJsonSchema = z
  .object({
    streams: z.array(FfprobeStreamSchema).optional().default([]),
    format: z
      .object({
        duration: z.union([z.string(), z.number()]).optional(),
        bit_rate: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
