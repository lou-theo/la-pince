import { describe, expect, it } from 'vitest';

import { canonicalJson } from './json.ts';

describe('canonicalJson', () => {
  it('gives the same text whatever the order of the fields, keeping the order of arrays', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(canonicalJson({ a: { c: null, d: [2, 1] }, b: 1 }));
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });
});
