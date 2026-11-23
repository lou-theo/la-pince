// Days are formatted in UTC: `YYYY-MM-DD` is read as midnight UTC, and any other zone could show the day before.
const longDays = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const headingDays = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

const midnight = (day: string) => new Date(`${day}T00:00:00Z`);

/** A calendar day (`YYYY-MM-DD`) in full, French style: `jeudi 5 novembre 2026`. */
export function formatDay(day: string): string {
  return longDays.format(midnight(day));
}

/** Heading of a day in the list: `Jeudi 5 novembre`, with the year only when it is not the year of `today` (`YYYY-MM-DD`). */
export function dayHeading(day: string, today: string): string {
  const text = (day.slice(0, 4) === today.slice(0, 4) ? headingDays : longDays).format(midnight(day));
  return text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1);
}

/** The day of `now` on this phone's calendar, `YYYY-MM-DD`: the day a person sees when entering an expense, not the UTC one. */
export function localDay(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const times = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const shortDays = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** When something happened, on this phone's clock: the time, `14:05`, and the day, `18 nov.`, only when it is not the day of `now`. */
export function momentOf(at: number, now: Date): { readonly time: string; readonly day: string | undefined } {
  const moment = new Date(at);
  return { time: times.format(moment), day: localDay(moment) === localDay(now) ? undefined : shortDays.format(moment) };
}
