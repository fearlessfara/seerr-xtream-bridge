import type { AppConfig } from '../config.js';
import { HttpClient } from '../lib/http.js';
import {
  SeerrArrSettingsListSchema,
  SeerrMediaSchema,
  SeerrRequestSchema,
  type SeerrRequest,
} from './schemas/seerr.js';

export class SeerrClient {
  private readonly http: HttpClient;

  constructor(config: AppConfig, fetchImpl?: typeof fetch) {
    this.http = new HttpClient({
      baseUrl: config.SEERR_URL,
      timeoutMs: config.HTTP_TIMEOUT_MS,
      serviceName: 'seerr',
      fetchImpl,
      defaultHeaders: { 'X-Api-Key': config.SEERR_API_KEY },
    });
  }

  async getRequest(requestId: number): Promise<SeerrRequest> {
    const { data } = await this.http.request('GET', `/api/v1/request/${requestId}`, {
      schema: SeerrRequestSchema,
    });
    return data as SeerrRequest;
  }

  async approveRequest(requestId: number): Promise<SeerrRequest> {
    const { data } = await this.http.request('POST', `/api/v1/request/${requestId}/approve`, {
      schema: SeerrRequestSchema,
    });
    return data as SeerrRequest;
  }

  async getMedia(mediaId: number) {
    const { data } = await this.http.request('GET', `/api/v1/media/${mediaId}`, {
      schema: SeerrMediaSchema,
    });
    return data;
  }

  async markMediaAvailable(
    mediaId: number,
    body?: { seasons?: Array<{ seasonNumber: number }>; is4k?: boolean },
  ) {
    const { data } = await this.http.request('POST', `/api/v1/media/${mediaId}/available`, {
      body: {
        is4k: body?.is4k ? 'true' : 'false',
        seasons: body?.seasons ?? [],
      },
      schema: SeerrMediaSchema,
    });
    return data;
  }

  async listRadarrSettings() {
    const { data } = await this.http.request('GET', '/api/v1/settings/radarr', {
      schema: SeerrArrSettingsListSchema,
    });
    return data;
  }

  async listSonarrSettings() {
    const { data } = await this.http.request('GET', '/api/v1/settings/sonarr', {
      schema: SeerrArrSettingsListSchema,
    });
    return data;
  }
}
