// What this phone remembers between visits, outside of any group (the copy of a group and who I am in it: `groupDb.ts`). Storage may be unavailable (private browsing, blocked site
// data): the app then asks again rather than failing.

const lastGroupKey = 'la-pince:last-group';

function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered: asked again on the next visit.
  }
}

/** Token of the last group opened, for an installed app that starts without its link. */
export const readLastGroup = (): string | undefined => read(lastGroupKey);
export const saveLastGroup = (token: string): void => {
  write(lastGroupKey, token);
};
