import type { AppConfig } from '../config.js';
import { HttpClient } from '../lib/http.js';
import type { ArrQualityProfileService } from './arr-quality.js';
import { ArrCustomFormatListSchema, ArrQualityProfileSchema } from './schemas/radarr-sonarr.js';
import { normalizeArrProfile } from '../domain/quality/resolver.js';
import type { ResolvedQualityProfile } from '../domain/quality/types.js';

export class RadarrClient implements ArrQualityProfileService {
  private readonly http: HttpClient;
  private readonly serverId: number;
  private readonly cache = new Map<number, { expires: number; value: ResolvedQualityProfile }>();
  private readonly ttlMs: number;

  constructor(
    opts: {
      baseUrl: string;
      apiKey: string;
      serverId: number;
      timeoutMs: number;
      cacheTtlSeconds: number;
    },
    fetchImpl?: typeof fetch,
  ) {
    this.http = new HttpClient({
      baseUrl: opts.baseUrl,
      timeoutMs: opts.timeoutMs,
      serviceName: 'radarr',
      fetchImpl,
      defaultHeaders: { 'X-Api-Key': opts.apiKey },
    });
    this.serverId = opts.serverId;
    this.ttlMs = opts.cacheTtlSeconds * 1000;
  }

  static fromEnv(config: AppConfig, serverId = 0, fetchImpl?: typeof fetch): RadarrClient | null {
    if (!config.RADARR_URL || !config.RADARR_API_KEY) return null;
    return new RadarrClient(
      {
        baseUrl: config.RADARR_URL,
        apiKey: config.RADARR_API_KEY,
        serverId,
        timeoutMs: config.HTTP_TIMEOUT_MS,
        cacheTtlSeconds: config.QUALITY_PROFILE_CACHE_TTL_SECONDS,
      },
      fetchImpl,
    );
  }

  async getProfile(profileId: number): Promise<ResolvedQualityProfile> {
    const cached = this.cache.get(profileId);
    if (cached && cached.expires > Date.now()) return cached.value;

    const { data } = await this.http.request('GET', `/api/v3/qualityprofile/${profileId}`, {
      schema: ArrQualityProfileSchema,
    });
    const normalized = normalizeArrProfile({
      source: 'radarr',
      serverId: this.serverId,
      profile: data as Parameters<typeof normalizeArrProfile>[0]['profile'],
    });
    this.cache.set(profileId, { expires: Date.now() + this.ttlMs, value: normalized });
    return normalized;
  }

  async listCustomFormats() {
    const { data } = await this.http.request('GET', '/api/v3/customformat', {
      schema: ArrCustomFormatListSchema,
    });
    return data;
  }
}
