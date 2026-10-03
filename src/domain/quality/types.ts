export type ArrType = 'radarr' | 'sonarr';
export type QualityUnknownPolicy = 'allow' | 'strict';
export type QualityConfidence = 'probed' | 'exact' | 'high' | 'medium' | 'low' | 'unknown';
export type HdrPreference = 'required' | 'preferred' | 'forbidden' | 'unknown';

export interface RequestQualityContext {
  mediaType: 'movie' | 'tv';
  serverId: number | null;
  profileId: number | null;
  profileName?: string;
  is4k: boolean;
  rootFolder?: string | null;
  tags?: number[] | null;
  languageProfileId?: number | null;
}

export interface ResolvedQuality {
  id: number;
  name: string;
  resolution?: number;
  source?: string;
  modifier?: string;
  allowed: boolean;
  weight: number;
}

export interface ResolvedCustomFormat {
  id: number;
  name: string;
  score: number;
}

export interface ObservableQualityConstraints {
  allowedResolutions: number[];
  preferredResolution?: number;
  allow2160p: boolean;
  allow1080p: boolean;
  allow720p: boolean;
  allowSD: boolean;
  hdrPreference: HdrPreference;
  codecs: string[];
}

export interface ResolvedQualityProfile {
  source: ArrType;
  serverId: number;
  profileId: number;
  name: string;
  allowedQualities: ResolvedQuality[];
  preferredOrder: ResolvedQuality[];
  upgradeAllowed?: boolean;
  cutoff?: string;
  cutoffId?: number;
  minFormatScore?: number;
  customFormats: ResolvedCustomFormat[];
  observableConstraints: ObservableQualityConstraints;
  rawSnapshot: unknown;
}

export interface XtreamMediaQuality {
  resolution?: 2160 | 1080 | 720 | 576 | 480;
  hdr?: boolean;
  dolbyVision?: boolean;
  codec?: string;
  source?: string;
  language?: string;
  audioLanguages?: string[];
  platform?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  confidence: QualityConfidence;
  evidence: string[];
  probed?: boolean;
}

export interface QualityEvaluation {
  compatible: boolean;
  score: number;
  reasons: string[];
  unknowns: string[];
  observed: Partial<XtreamMediaQuality>;
  languageScore?: number;
}

export interface QualityDecision {
  profile: Pick<ResolvedQualityProfile, 'source' | 'serverId' | 'profileId' | 'name'>;
  candidateName: string;
  /** Browse leaf stream/series id for the selected candidate. */
  candidateId?: string;
  /** Exact container_extension from /api/browse (e.g. mkv), when known. */
  containerExtension?: string;
  evaluation: QualityEvaluation;
  policy: QualityUnknownPolicy;
  selectedAt: string;
}
