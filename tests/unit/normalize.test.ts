import { describe, expect, it } from 'vitest';
import { extractYear, normalizeTitle, titlesMatch } from '../../src/domain/matching/normalize.js';

describe('title normalization', () => {
  it('normalizes punctuation and articles', () => {
    expect(normalizeTitle('The Lord of the Rings: The Fellowship')).toBe(
      normalizeTitle('Lord of the Rings Fellowship'),
    );
  });

  it('extracts year', () => {
    expect(extractYear('Dune (2021)')).toBe(2021);
  });

  it('matches titles', () => {
    expect(titlesMatch('Dune: Part Two', 'Dune Part Two')).toBe(true);
  });
});
