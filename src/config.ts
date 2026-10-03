import { z } from 'zod';

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

const envSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(5056),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_PATH: z.string().default('./data/bridge.db'),
  BRIDGE_API_KEY: z.string().optional().default(''),
  SEERR_URL: z.string().url(),
  SEERR_API_KEY: z.string().min(1),
  SEERR_WEBHOOK_SECRET: z.string().optional().default(''),
  SEERR_AVAILABILITY_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(60),
  SEERR_REQUEST_COMPLETION_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(60),
  XTREAMFILTER_URL: z.string().url(),
  XTREAMFILTER_SOURCE_ID: z.string().optional().default(''),
  XTREAMFILTER_SOURCE_NAME: z.string().optional().default(''),
  JELLYFIN_URL: z.string().url(),
  JELLYFIN_API_KEY: z.string().min(1),
  RADARR_URL: z.string().url().optional().or(z.literal('')).default(''),
  RADARR_API_KEY: z.string().optional().default(''),
  SONARR_URL: z.string().url().optional().or(z.literal('')).default(''),
  SONARR_API_KEY: z.string().optional().default(''),
  RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  XTREAM_PARTIAL_POLICY: z
    .enum(['all_or_nothing', 'download_available_then_fallback', 'xtream_only'])
    .default('all_or_nothing'),
  QUALITY_UNKNOWN_POLICY: z.enum(['allow', 'strict']).default('allow'),
  QUALITY_PROFILE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),
  METRICS_REQUIRE_AUTH: boolish.default(false),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  return parsed.data;
}
