import type { AppConfig } from '../config.js';
import { buildArrBaseUrl } from '../clients/arr-quality.js';
import { RadarrClient } from '../clients/radarr.js';
import type { SeerrClient } from '../clients/seerr.js';
import { SonarrClient } from '../clients/sonarr.js';
import type { SeerrRequest } from '../clients/schemas/seerr.js';
import { BridgeError } from '../lib/errors.js';
import type { ResolvedQualityProfile, RequestQualityContext } from '../domain/quality/types.js';

export function requestQualityContext(req: SeerrRequest): RequestQualityContext {
  return {
    mediaType: req.type === 'tv' ? 'tv' : 'movie',
    serverId: req.serverId ?? null,
    profileId: req.profileId ?? null,
    is4k: !!req.is4k,
    rootFolder: req.rootFolder,
    tags: req.tags,
    languageProfileId: req.languageProfileId,
  };
}

export class QualityProfileResolverService {
  constructor(
    private readonly config: AppConfig,
    private readonly seerr: SeerrClient,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async resolve(req: SeerrRequest): Promise<ResolvedQualityProfile> {
    const ctx = requestQualityContext(req);
    if (ctx.mediaType === 'movie') {
      return this.resolveRadarr(ctx);
    }
    return this.resolveSonarr(ctx);
  }

  private async resolveRadarr(ctx: RequestQualityContext): Promise<ResolvedQualityProfile> {
    const settings = await this.seerr.listRadarrSettings();
    const server =
      (ctx.serverId != null ? settings.find((s) => s.id === ctx.serverId) : undefined) ??
      settings.find((s) => s.isDefault && !!s.is4k === ctx.is4k) ??
      settings.find((s) => s.isDefault) ??
      settings[0];

    const profileId = ctx.profileId ?? server?.activeProfileId;
    if (profileId == null) {
      throw new BridgeError('No Radarr profileId on request or default server', {
        errorClass: 'permanent',
      });
    }

    let client: RadarrClient | null = null;
    if (server?.hostname && server.apiKey) {
      client = new RadarrClient(
        {
          baseUrl: buildArrBaseUrl(server),
          apiKey: server.apiKey,
          serverId: server.id,
          timeoutMs: this.config.HTTP_TIMEOUT_MS,
          cacheTtlSeconds: this.config.QUALITY_PROFILE_CACHE_TTL_SECONDS,
        },
        this.fetchImpl,
      );
    } else {
      client = RadarrClient.fromEnv(this.config, server?.id ?? 0, this.fetchImpl);
    }

    if (!client) {
      throw new BridgeError('Unable to resolve Radarr connection for quality profile', {
        errorClass: 'permanent',
      });
    }

    try {
      return await client.getProfile(profileId);
    } catch (err) {
      if (err instanceof BridgeError && err.statusCode === 404) {
        throw new BridgeError(`Radarr quality profile ${profileId} not found`, {
          errorClass: 'permanent',
          cause: err,
        });
      }
      throw err;
    }
  }

  private async resolveSonarr(ctx: RequestQualityContext): Promise<ResolvedQualityProfile> {
    const settings = await this.seerr.listSonarrSettings();
    const server =
      (ctx.serverId != null ? settings.find((s) => s.id === ctx.serverId) : undefined) ??
      settings.find((s) => s.isDefault && !!s.is4k === ctx.is4k) ??
      settings.find((s) => s.isDefault) ??
      settings[0];

    const profileId = ctx.profileId ?? server?.activeProfileId;
    if (profileId == null) {
      throw new BridgeError('No Sonarr profileId on request or default server', {
        errorClass: 'permanent',
      });
    }

    let client: SonarrClient | null = null;
    if (server?.hostname && server.apiKey) {
      client = new SonarrClient(
        {
          baseUrl: buildArrBaseUrl(server),
          apiKey: server.apiKey,
          serverId: server.id,
          timeoutMs: this.config.HTTP_TIMEOUT_MS,
          cacheTtlSeconds: this.config.QUALITY_PROFILE_CACHE_TTL_SECONDS,
        },
        this.fetchImpl,
      );
    } else {
      client = SonarrClient.fromEnv(this.config, server?.id ?? 0, this.fetchImpl);
    }

    if (!client) {
      throw new BridgeError('Unable to resolve Sonarr connection for quality profile', {
        errorClass: 'permanent',
      });
    }

    try {
      return await client.getProfile(profileId);
    } catch (err) {
      if (err instanceof BridgeError && err.statusCode === 404) {
        throw new BridgeError(`Sonarr quality profile ${profileId} not found`, {
          errorClass: 'permanent',
          cause: err,
        });
      }
      throw err;
    }
  }
}
