import { extractYear, normalizeTitle, titlesMatch } from './normalize.js';
import type { MatchCandidate, MatchResult } from './types.js';

export interface MatchInput {
  tmdbId: number;
  title?: string;
  year?: number;
  contentType: 'vod' | 'series';
  preferredSourceId?: string;
  preferredSourceName?: string;
  candidates: MatchCandidate[];
}

function preferSource(
  cands: MatchCandidate[],
  sourceId?: string,
  sourceName?: string,
): MatchCandidate[] {
  if (sourceId) {
    const filtered = cands.filter((c) => c.sourceId === sourceId);
    if (filtered.length) return filtered;
  }
  if (sourceName) {
    const needle = sourceName.toLowerCase();
    const filtered = cands.filter((c) => (c.sourceName ?? '').toLowerCase() === needle);
    if (filtered.length) return filtered;
  }
  return cands;
}

export function matchMedia(input: MatchInput): MatchResult {
  const typed = input.candidates.filter((c) => c.contentType === input.contentType);
  const reasons: string[] = [];

  const byTmdb = typed.filter((c) => {
    const tid = c.tmdbId == null ? '' : String(c.tmdbId).replace(/^tmdb:/i, '');
    return tid === String(input.tmdbId);
  });

  if (byTmdb.length === 1) {
    const selected =
      preferSource(byTmdb, input.preferredSourceId, input.preferredSourceName)[0] ?? byTmdb[0];
    return { kind: 'EXACT_ID', selected, candidates: byTmdb, reasons: ['TMDb ID exact match'] };
  }
  if (byTmdb.length > 1) {
    const preferred = preferSource(byTmdb, input.preferredSourceId, input.preferredSourceName);
    if (preferred.length === 1) {
      return {
        kind: 'EXACT_ID',
        selected: preferred[0],
        candidates: byTmdb,
        reasons: ['TMDb ID exact match with preferred source'],
      };
    }
    // Multiple streams same TMDb (different sources/qualities) — keep as EXACT_ID multi for quality eval
    return {
      kind: 'EXACT_ID',
      candidates: preferred.length ? preferred : byTmdb,
      reasons: ['Multiple TMDb exact matches; defer to quality evaluation'],
    };
  }

  if (!input.title) {
    return {
      kind: 'NOT_FOUND',
      candidates: typed,
      reasons: ['No TMDb match and no title for fallback'],
    };
  }

  const year = input.year;
  const titleYear = typed.filter((c) => {
    if (!titlesMatch(c.name, input.title!)) return false;
    const cy = c.year ?? extractYear(c.name);
    return year != null && cy != null && cy === year;
  });

  if (titleYear.length === 1) {
    return {
      kind: 'EXACT_TITLE_YEAR',
      selected: titleYear[0],
      candidates: titleYear,
      reasons: ['Normalized title + year match'],
    };
  }
  if (titleYear.length > 1) {
    return {
      kind: 'AMBIGUOUS',
      candidates: titleYear,
      reasons: [`Ambiguous title+year matches: ${titleYear.length}`],
    };
  }

  const titleOnly = typed.filter((c) => titlesMatch(c.name, input.title!));
  if (titleOnly.length === 1) {
    return {
      kind: 'UNAMBIGUOUS_TITLE',
      selected: titleOnly[0],
      candidates: titleOnly,
      reasons: ['Unambiguous normalized title match'],
    };
  }
  if (titleOnly.length > 1) {
    return {
      kind: 'AMBIGUOUS',
      candidates: titleOnly,
      reasons: [
        `Ambiguous title matches: ${titleOnly.length}`,
        `norm=${normalizeTitle(input.title)}`,
      ],
    };
  }

  reasons.push('No identity match');
  return { kind: 'NOT_FOUND', candidates: typed, reasons };
}
