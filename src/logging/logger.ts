import pino from 'pino';
import type { AppConfig } from '../config.js';

export type Logger = pino.Logger;

export function createLogger(config: AppConfig): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: 'seerr-xtream-bridge' },
    redact: {
      paths: [
        'apiKey',
        'password',
        'authorization',
        'headers.authorization',
        'headers["x-api-key"]',
        'SEERR_API_KEY',
        'JELLYFIN_API_KEY',
        'RADARR_API_KEY',
        'SONARR_API_KEY',
        'BRIDGE_API_KEY',
        'SEERR_WEBHOOK_SECRET',
      ],
      censor: '[REDACTED]',
    },
  });
}

export interface AcquisitionLogFields {
  requestId?: number | string;
  mediaType?: string;
  tmdbId?: number | string;
  season?: number;
  episode?: number;
  jobId?: string | number;
  state?: string;
}
