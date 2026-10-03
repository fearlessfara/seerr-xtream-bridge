import { describe, expect, it } from 'vitest';

/** Mirrors engine all_or_nothing gap detection */
function seasonComplete(episodeNums: number[]): boolean {
  if (!episodeNums.length) return false;
  const max = Math.max(...episodeNums);
  for (let i = 1; i <= max; i++) {
    if (!episodeNums.includes(i)) return false;
  }
  return true;
}

describe('TV all_or_nothing', () => {
  it('accepts complete seasons', () => {
    expect(seasonComplete([1, 2, 3, 4, 5])).toBe(true);
  });

  it('rejects gaps', () => {
    expect(seasonComplete([1, 2, 3, 4, 5, 6, 7, 8])).toBe(true);
    expect(seasonComplete([1, 2, 3, 4, 5, 6, 7, 8 /* missing 9,10 but max=8 */])).toBe(true);
    expect(seasonComplete([1, 2, 3, 4, 5, 6, 7, 8, 10])).toBe(false);
  });
});
