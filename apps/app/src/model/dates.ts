// The day is formatted in UTC: `YYYY-MM-DD` is read as midnight UTC, and any other zone could show the day before.
const days = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const longDays = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A calendar day (`YYYY-MM-DD`) French style: `5 nov. 2026`, or `jeudi 5 novembre 2026` in full. */
export function formatDay(day: string, { long = false }: { readonly long?: boolean } = {}): string {
  return (long ? longDays : days).format(new Date(`${day}T00:00:00Z`));
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
