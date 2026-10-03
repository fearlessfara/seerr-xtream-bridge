import type { ResolvedQualityProfile } from '../domain/quality/types.js';

export interface ArrQualityProfileService {
  getProfile(profileId: number): Promise<ResolvedQualityProfile>;
}

export function buildArrBaseUrl(settings: {
  hostname: string;
  port: number;
  useSsl?: boolean;
  baseUrl?: string | null;
}): string {
  const proto = settings.useSsl ? 'https' : 'http';
  const base = (settings.baseUrl ?? '').replace(/\/+$/, '');
  const prefix = base.startsWith('/') ? base : base ? `/${base}` : '';
  return `${proto}://${settings.hostname}:${settings.port}${prefix}`;
}
