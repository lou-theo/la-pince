import { describe, expect, it } from 'vitest';

import { compareIds } from './ids.ts';

describe('compareIds', () => {
  it.each([
    ['a', 'b', -1],
    ['b', 'a', 1],
    ['a', 'a', 0],
    // By code unit, not by locale: uppercase before lowercase, accented letters after z.
    ['Z', 'a', -1],
    ['z', 'é', -1],
  ])('compares %s with %s', (a, b, expected) => {
    expect(compareIds(a, b)).toBe(expected);
  });
});
