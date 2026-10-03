import { scoreLanguagePreference } from './language.js';
import type {
  QualityEvaluation,
  QualityUnknownPolicy,
  ResolvedQualityProfile,
  XtreamMediaQuality,
} from './types.js';

export function evaluateCandidateQuality(input: {
  profile: ResolvedQualityProfile;
  observed: XtreamMediaQuality;
  policy: QualityUnknownPolicy;
  /** When true, unprobed / unknown resolution is never compatible (VOD selection). */
  requireProbeEvidence?: boolean;
  preferredLanguages?: string[];
}): QualityEvaluation {
  const { profile, observed, policy } = input;
  const preferredLanguages = input.preferredLanguages?.length ? input.preferredLanguages : ['en'];
  const reasons: string[] = [];
  const unknowns: string[] = [];
  const c = profile.observableConstraints;
  let score = 0;
  let compatible = true;

  const lang = scoreLanguagePreference({
    preferredLanguages,
    catalogueLanguage: observed.language,
    audioLanguages: observed.audioLanguages,
  });
  reasons.push(lang.reason);
  score += lang.score;

  if (input.requireProbeEvidence && !observed.probed) {
    compatible = false;
    reasons.push('probe evidence required; candidate not probed');
  }

  if (observed.resolution == null) {
    unknowns.push('resolution');
    if (input.requireProbeEvidence || policy === 'strict') {
      compatible = false;
      reasons.push(
        input.requireProbeEvidence
          ? 'resolution unknown after probe requirement'
          : 'strict policy rejects unknown resolution',
      );
    } else {
      reasons.push('resolution unknown; allow policy keeps candidate');
    }
  } else if (!c.allowedResolutions.includes(observed.resolution)) {
    compatible = false;
    reasons.push(`resolution ${observed.resolution} not allowed by profile ${profile.name}`);
  } else {
    reasons.push(`resolution ${observed.resolution} allowed`);
    score += observed.resolution;
    if (c.preferredResolution != null) {
      score += Math.max(0, 1000 - Math.abs(c.preferredResolution - observed.resolution));
    }
  }

  if (observed.source == null) unknowns.push('source');
  else {
    const sourceAllowed = profile.allowedQualities.some(
      (q) => q.source && q.source.toLowerCase().includes(observed.source!.toLowerCase()),
    );
    if (!sourceAllowed && profile.allowedQualities.some((q) => q.source)) {
      reasons.push(`source ${observed.source} not clearly in profile ladder`);
      score -= 50;
    } else if (sourceAllowed) {
      reasons.push(`source ${observed.source} compatible`);
      score += 100;
    }
  }

  if (observed.codec == null) unknowns.push('codec');
  else {
    reasons.push(`codec ${observed.codec} observed`);
    const cf = profile.customFormats.find((f) =>
      new RegExp(observed.codec!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(f.name),
    );
    if (cf) score += cf.score;
  }

  if (observed.hdr == null && observed.dolbyVision == null) {
    unknowns.push('hdr');
  } else if (c.hdrPreference === 'forbidden' && (observed.hdr || observed.dolbyVision)) {
    compatible = false;
    reasons.push('HDR/DV forbidden by profile custom formats');
  } else if (c.hdrPreference === 'preferred' && (observed.hdr || observed.dolbyVision)) {
    reasons.push('HDR preferred and present');
    score += 150;
  } else if (c.hdrPreference === 'required' && !(observed.hdr || observed.dolbyVision)) {
    compatible = false;
    reasons.push('HDR required but not observed');
  }

  if (observed.probed) {
    reasons.push('ffprobe evidence present');
    score += 2_000;
  }

  if (!unknowns.includes('releaseGroup')) {
    unknowns.push('releaseGroup');
  }

  // Strict: unknown source still matters when no probe proved resolution.
  if (policy === 'strict' && !input.requireProbeEvidence) {
    const importantUnknowns = unknowns.filter((u) => u === 'resolution' || u === 'source');
    if (importantUnknowns.length) {
      compatible = false;
      reasons.push(`strict policy rejects unknowns: ${importantUnknowns.join(', ')}`);
    }
  }

  // With probe evidence, unknown source alone must not veto under allow policy.
  if (
    policy === 'strict' &&
    input.requireProbeEvidence &&
    unknowns.includes('source') &&
    observed.resolution == null
  ) {
    compatible = false;
    reasons.push('strict policy rejects unknown source without resolution');
  }

  if (!compatible) score = Math.min(score, -1);

  return {
    compatible,
    score,
    reasons,
    unknowns: [...new Set(unknowns)],
    languageScore: lang.score,
    observed: {
      resolution: observed.resolution,
      codec: observed.codec,
      source: observed.source,
      hdr: observed.hdr,
      dolbyVision: observed.dolbyVision,
      language: observed.language,
      audioLanguages: observed.audioLanguages,
      platform: observed.platform,
      width: observed.width,
      height: observed.height,
      bitrate: observed.bitrate,
      confidence: observed.confidence,
      probed: observed.probed,
    },
  };
}

export function pickBestCompatible<T extends { evaluation: QualityEvaluation; tieKey: string }>(
  items: T[],
): T | undefined {
  const ok = items.filter((i) => i.evaluation.compatible);
  if (!ok.length) return undefined;
  return [...ok].sort((a, b) => {
    if (b.evaluation.score !== a.evaluation.score) return b.evaluation.score - a.evaluation.score;
    return a.tieKey.localeCompare(b.tieKey);
  })[0];
}
