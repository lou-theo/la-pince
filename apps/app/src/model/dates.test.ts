import { describe, expect, it } from 'vitest';

import { formatDay } from './dates.ts';

describe('formatDay', () => {
  it('writes the calendar day as entered, never the day before, short or in full', () => {
    expect(formatDay('2026-11-05')).toBe('5 nov. 2026');
    expect(formatDay('2026-01-01')).toBe('1 janv. 2026');
    expect(formatDay('2026-12-31', { long: true })).toBe('jeudi 31 décembre 2026');
  });
});
