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

/** Whether the value was stored. */
function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    // Not remembered: asked again on the next visit.
    return false;
  }
}

/** Token of the last group opened, for an installed app that starts without its link. */
export const readLastGroup = (): string | undefined => read(lastGroupKey);
export const saveLastGroup = (token: string): void => {
  write(lastGroupKey, token);
};

const installOfferedKey = 'la-pince:install-offered';
// Where the browser refuses storage: offered once per visit, rather than at each screen.
let offeredInMemory = false;

/**
 * Whether this browser was offered to install the app: offered once, whatever came of it (“Plus tard”, guide left halfway), then only on demand.
 * Kept by browser, not by phone: another browser of the same phone offers it again.
 */
export const wasInstallOffered = (): boolean => offeredInMemory || read(installOfferedKey) !== undefined;
export const rememberInstallOffered = (): void => {
  offeredInMemory ||= !write(installOfferedKey, new Date().toISOString());
};
