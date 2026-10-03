export type MatchResultKind =
  'EXACT_ID' | 'EXACT_TITLE_YEAR' | 'UNAMBIGUOUS_TITLE' | 'AMBIGUOUS' | 'NOT_FOUND';

export interface MatchCandidate {
  sourceId: string;
  sourceName?: string;
  streamId?: string;
  seriesId?: string;
  name: string;
  group?: string;
  tmdbId?: string | number | null;
  year?: number;
  contentType: 'vod' | 'series';
  containerExtension?: string;
  raw?: unknown;
}

export interface MatchResult {
  kind: MatchResultKind;
  selected?: MatchCandidate;
  candidates: MatchCandidate[];
  reasons: string[];
}
