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
    // Seerr expects JSON booleans (frontend sends boolean is4k). Do not stringify.
    // seasons must be omitted for movies; only included for TV.
    const payload: { is4k: boolean; seasons?: Array<{ seasonNumber: number }> } = {
      is4k: Boolean(body?.is4k),
    };
    if (body?.seasons !== undefined) {
      payload.seasons = body.seasons;
    }

    const { data } = await this.http.request('POST', `/api/v1/media/${mediaId}/available`, {
      body: payload,
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
