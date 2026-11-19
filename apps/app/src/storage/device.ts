// What this phone remembers between visits, until the offline step brings IndexedDB. Storage may be unavailable (private browsing, blocked site
// data): the app then asks again rather than failing.

const lastGroupKey = 'la-pince:last-group';
const currentMemberKey = (token: string) => `la-pince:group:${token}:current-member`;

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

/** “Who I am” in a group, as chosen on this phone; the caller checks it is still a member. */
export const readCurrentMember = (token: string): string | undefined => read(currentMemberKey(token));
export const saveCurrentMember = (token: string, memberId: string): void => {
  write(currentMemberKey(token), memberId);
};
