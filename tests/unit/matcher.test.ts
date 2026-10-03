import { describe, expect, it } from 'vitest';
import { matchMedia } from '../../src/domain/matching/matcher.js';
import type { MatchCandidate } from '../../src/domain/matching/types.js';

const base: MatchCandidate[] = [
  {
    sourceId: 's1',
    streamId: '1',
    name: 'Dune 2021 1080p',
    tmdbId: '693134',
    contentType: 'vod',
  },
  {
    sourceId: 's2',
    streamId: '2',
    name: 'Other Movie',
    tmdbId: '1',
    contentType: 'vod',
  },
];

describe('matchMedia', () => {
  it('exact TMDb match', () => {
    const r = matchMedia({ tmdbId: 693134, contentType: 'vod', candidates: base });
    expect(r.kind).toBe('EXACT_ID');
    expect(r.selected?.streamId).toBe('1');
  });

  it('ambiguous titles fall back', () => {
    const cands: MatchCandidate[] = [
      { sourceId: 'a', streamId: '1', name: 'Matrix', contentType: 'vod' },
      { sourceId: 'b', streamId: '2', name: 'Matrix', contentType: 'vod' },
    ];
    const r = matchMedia({ tmdbId: 999, title: 'Matrix', contentType: 'vod', candidates: cands });
    expect(r.kind).toBe('AMBIGUOUS');
  });

  it('not found', () => {
    const r = matchMedia({ tmdbId: 42, contentType: 'vod', candidates: base });
    expect(r.kind).toBe('NOT_FOUND');
  });
});
