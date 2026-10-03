import type { MatchCandidate } from '../matching/types.js';
import { isObviousLanguageMismatch, scoreLanguagePreference } from './language.js';
import { parseXtreamQuality } from './parser.js';
import type { ResolvedQualityProfile } from './types.js';

export interface ShortlistEntry {
  candidate: MatchCandidate;
  catalogueLanguage?: string;
  platform?: string;
  languageScore: number;
  languageReason: string;
  catalogueResolution?: number;
  /** Soft hint: catalogue claims 4K while profile forbids it. */
  catalogueResolutionForbidden: boolean;
}

/**
 * Rank candidates for sequential probing. Prefer desired language; deprioritize
 * obvious mismatches and catalogue 4K when the profile forbids 2160.
 */
export function buildProbeShortlist(input: {
  candidates: MatchCandidate[];
  preferredLanguages: string[];
  profile: ResolvedQualityProfile;
  maxProbes: number;
}): ShortlistEntry[] {
  const ranked: ShortlistEntry[] = input.candidates.map((candidate) => {
    const observed = parseXtreamQuality({
      name: candidate.name,
      group: candidate.group,
      containerExtension: candidate.containerExtension,
    });
    const lang = scoreLanguagePreference({
      preferredLanguages: input.preferredLanguages,
      catalogueLanguage: observed.language,
    });
    const catalogueResolutionForbidden =
      observed.resolution != null &&
      !input.profile.observableConstraints.allowedResolutions.includes(observed.resolution);

    return {
      candidate,
      catalogueLanguage: observed.language,
      platform: observed.platform,
      languageScore: lang.score,
      languageReason: lang.reason,
      catalogueResolution: observed.resolution,
      catalogueResolutionForbidden,
    };
  });

  ranked.sort((a, b) => {
    if (b.languageScore !== a.languageScore) return b.languageScore - a.languageScore;
    // Prefer not probing obviously-forbidden catalogue resolutions first
    if (a.catalogueResolutionForbidden !== b.catalogueResolutionForbidden) {
      return a.catalogueResolutionForbidden ? 1 : -1;
    }
    // Prefer known non-forbidden catalogue resolution over unknown
    const aKnown = a.catalogueResolution != null && !a.catalogueResolutionForbidden ? 1 : 0;
    const bKnown = b.catalogueResolution != null && !b.catalogueResolutionForbidden ? 1 : 0;
    if (bKnown !== aKnown) return bKnown - aKnown;
    const aId = a.candidate.streamId ?? a.candidate.seriesId ?? a.candidate.name;
    const bId = b.candidate.streamId ?? b.candidate.seriesId ?? b.candidate.name;
    return aId.localeCompare(bId);
  });

  // Soft-filter: if we have any non-mismatch preferred/unknown language candidates,
  // exclude obvious mismatches from the shortlist to save probes.
  const nonMismatch = ranked.filter(
    (e) =>
      !isObviousLanguageMismatch(input.preferredLanguages, e.catalogueLanguage) ||
      e.languageScore >= 0,
  );
  const pool = nonMismatch.length ? nonMismatch : ranked;
  return pool.slice(0, input.maxProbes);
}

export function shouldStopProbing(input: {
  preferredLanguages: string[];
  selectedLanguageScore: number;
  compatible: boolean;
}): boolean {
  if (!input.compatible) return false;
  // Preferred language matched (catalogue or audio) is enough to stop.
  return input.selectedLanguageScore >= 6_000;
}
