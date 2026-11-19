import { describe, expect, it } from 'vitest';

import { formatDay, localDay, momentOf } from './dates.ts';

describe('formatDay', () => {
  it('writes the calendar day as entered, never the day before, short or in full', () => {
    expect(formatDay('2026-11-05')).toBe('5 nov. 2026');
    expect(formatDay('2026-01-01')).toBe('1 janv. 2026');
    expect(formatDay('2026-12-31', { long: true })).toBe('jeudi 31 décembre 2026');
  });
});

describe('localDay', () => {
  it("gives the day of the phone's calendar, not the UTC one", () => {
    // Tests run at UTC-10: 05:00 UTC on 6 November is still 5 November here.
    expect(localDay(new Date('2026-11-06T05:00:00Z'))).toBe('2026-11-05');
    expect(localDay(new Date(2026, 0, 9))).toBe('2026-01-09');
  });
});

describe('momentOf', () => {
  it("gives the time on the phone's clock, with the day when it is not today", () => {
    // Tests run at UTC-10.
    const now = new Date('2026-11-19T20:00:00Z');
    expect(momentOf(Date.parse('2026-11-19T19:05:00Z'), now)).toStrictEqual({ time: '09:05', day: undefined });
    expect(momentOf(Date.parse('2026-11-19T05:00:00Z'), now)).toStrictEqual({ time: '19:00', day: '18 nov.' });
  });
});
