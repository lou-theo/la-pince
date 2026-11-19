// The day is formatted in UTC: `YYYY-MM-DD` is read as midnight UTC, and any other zone could show the day before.
const days = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const longDays = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A calendar day (`YYYY-MM-DD`) French style: `5 nov. 2026`, or `jeudi 5 novembre 2026` in full. */
export function formatDay(day: string, { long = false }: { readonly long?: boolean } = {}): string {
  return (long ? longDays : days).format(new Date(`${day}T00:00:00Z`));
}
