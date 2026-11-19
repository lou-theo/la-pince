import { momentOf } from '../model/dates.ts';
import { m } from './paraglide/messages.js';

/** When something happened, as the screens tell it: `à 14:05` the same day, `le 18 nov. à 14:05` before. */
export function formatMoment(at: number, now: Date = new Date()): string {
  const { time, day } = momentOf(at, now);
  return day === undefined ? m.moment_today({ time }) : m.moment_other_day({ day, time });
}
