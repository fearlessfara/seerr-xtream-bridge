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
}): QualityEvaluation {
  const { profile, observed, policy } = input;
  const reasons: string[] = [];
  const unknowns: string[] = [];
  const c = profile.observableConstraints;
  let score = 0;
  let compatible = true;

  if (observed.resolution == null) {
    unknowns.push('resolution');
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
      // Soft: many IPTV titles lack precise source; only hard-fail in strict when source claimed but unmatched
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

  if (unknowns.includes('releaseGroup') === false) {
    // always unknown from Xtream
    unknowns.push('releaseGroup');
  }

  if (policy === 'strict') {
    const importantUnknowns = unknowns.filter((u) => u === 'resolution' || u === 'source');
    if (importantUnknowns.length) {
      compatible = false;
      reasons.push(`strict policy rejects unknowns: ${importantUnknowns.join(', ')}`);
    }
  } else if (observed.resolution == null && c.allowedResolutions.length > 0) {
    // allow: resolution unknown — do not auto-reject
    reasons.push('resolution unknown; allow policy keeps candidate');
  }

  if (!compatible) score = Math.min(score, -1);

  return {
    compatible,
    score,
    reasons,
    unknowns: [...new Set(unknowns)],
    observed: {
      resolution: observed.resolution,
      codec: observed.codec,
      source: observed.source,
      hdr: observed.hdr,
      dolbyVision: observed.dolbyVision,
      confidence: observed.confidence,
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
