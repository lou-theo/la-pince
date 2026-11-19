import { describe, expect, it } from 'vitest';

import { formatMoment } from './moment.ts';

describe('formatMoment', () => {
  // The tests run in UTC-10.
  it('gives the time alone the same day, and the day before it otherwise', () => {
    const now = new Date('2026-11-19T20:00:00Z');
    expect(formatMoment(Date.parse('2026-11-19T19:05:00Z'), now)).toBe('à 09:05');
    expect(formatMoment(Date.parse('2026-11-19T05:00:00Z'), now)).toBe('le 18 nov. à 19:00');
  });
});
