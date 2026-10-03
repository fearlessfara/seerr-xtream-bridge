import type {
  ArrType,
  ObservableQualityConstraints,
  ResolvedCustomFormat,
  ResolvedQuality,
  ResolvedQualityProfile,
} from './types.js';

export interface ArrQualityItem {
  id?: number;
  name?: string | null;
  allowed: boolean;
  quality?: {
    id: number;
    name: string;
    source?: string;
    resolution?: number;
    modifier?: string;
  } | null;
  items?: ArrQualityItem[];
}

export interface ArrQualityProfileResponse {
  id: number;
  name: string;
  upgradeAllowed?: boolean;
  cutoff?: number;
  items?: ArrQualityItem[] | unknown[];
  minFormatScore?: number;
  formatItems?: Array<{ format: number; name: string; score: number }>;
  [key: string]: unknown;
}

function flattenQualities(
  items: ArrQualityItem[] | unknown[] | undefined,
  weightBase = 0,
): ResolvedQuality[] {
  const out: ResolvedQuality[] = [];
  let weight = weightBase;
  for (const raw of items ?? []) {
    const item = raw as ArrQualityItem;
    if (item.quality) {
      out.push({
        id: item.quality.id,
        name: item.quality.name,
        resolution: item.quality.resolution,
        source: item.quality.source,
        modifier: item.quality.modifier,
        allowed: item.allowed,
        weight: weight++,
      });
    } else if (item.items?.length) {
      const nested = flattenQualities(item.items, weight);
      for (const n of nested) {
        n.allowed = item.allowed && n.allowed;
        out.push(n);
        weight = Math.max(weight, n.weight + 1);
      }
    }
  }
  return out;
}

function buildConstraints(allowed: ResolvedQuality[]): ObservableQualityConstraints {
  const resolutions = [
    ...new Set(allowed.map((q) => q.resolution).filter((r): r is number => typeof r === 'number')),
  ].sort((a, b) => a - b);

  return {
    allowedResolutions: resolutions,
    preferredResolution: resolutions.length ? resolutions[resolutions.length - 1] : undefined,
    allow2160p: resolutions.includes(2160),
    allow1080p: resolutions.includes(1080),
    allow720p: resolutions.includes(720),
    allowSD: resolutions.some((r) => r > 0 && r < 720),
    hdrPreference: 'unknown',
    codecs: [],
  };
}

export function normalizeArrProfile(input: {
  source: ArrType;
  serverId: number;
  profile: ArrQualityProfileResponse;
}): ResolvedQualityProfile {
  const all = flattenQualities(input.profile.items);
  const allowed = all.filter((q) => q.allowed);
  const preferredOrder = [...allowed].sort((a, b) => b.weight - a.weight);

  const cutoffQuality = all.find((q) => q.id === input.profile.cutoff);
  const customFormats: ResolvedCustomFormat[] = (input.profile.formatItems ?? []).map((f) => ({
    id: f.format,
    name: f.name,
    score: f.score,
  }));

  // Infer HDR preference from CF scores when present
  const constraints = buildConstraints(allowed);
  const hdrCf = customFormats.find((c) => /hdr|dolby|dv/i.test(c.name));
  if (hdrCf) {
    if (hdrCf.score < 0) constraints.hdrPreference = 'forbidden';
    else if (hdrCf.score > 0) constraints.hdrPreference = 'preferred';
  }

  return {
    source: input.source,
    serverId: input.serverId,
    profileId: input.profile.id,
    name: input.profile.name,
    allowedQualities: allowed,
    preferredOrder,
    upgradeAllowed: input.profile.upgradeAllowed,
    cutoff: cutoffQuality?.name,
    cutoffId: input.profile.cutoff,
    minFormatScore: input.profile.minFormatScore,
    customFormats,
    observableConstraints: constraints,
    rawSnapshot: {
      id: input.profile.id,
      name: input.profile.name,
      upgradeAllowed: input.profile.upgradeAllowed,
      cutoff: input.profile.cutoff,
      minFormatScore: input.profile.minFormatScore,
      allowed: allowed.map((q) => ({
        id: q.id,
        name: q.name,
        resolution: q.resolution,
        source: q.source,
      })),
      formatItems: customFormats,
    },
  };
}
