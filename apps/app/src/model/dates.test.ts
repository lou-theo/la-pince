import { describe, expect, it } from 'vitest';

import { dayHeading, formatDay, localDay, momentOf } from './dates.ts';

describe('formatDay', () => {
  it('writes the calendar day in full as entered, never the day before', () => {
    expect(formatDay('2026-12-31')).toBe('jeudi 31 décembre 2026');
    expect(formatDay('2026-01-01')).toBe('jeudi 1 janvier 2026');
  });
});

describe('dayHeading', () => {
  it('capitalizes the day, never the day before, and gives the year only for another year than today', () => {
    expect(dayHeading('2026-11-17', '2026-11-23')).toBe('Mardi 17 novembre');
    expect(dayHeading('2025-12-31', '2026-11-23')).toBe('Mercredi 31 décembre 2025');
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
