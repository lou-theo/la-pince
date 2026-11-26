// What this phone remembers between visits, outside of any group (the copy of a group and who I am in it: `groupDb.ts`). Storage may be unavailable (private browsing, blocked site
// data): the app then asks again rather than failing.

const lastGroupKey = 'la-pince:last-group';

// The storage is reached inside the `try`: merely reading `localStorage` throws where site data is blocked.
const local = () => localStorage;

function read(key: string, storage = local): string | undefined {
  try {
    return storage().getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Whether the value was stored. */
function write(key: string, value: string, storage = local): boolean {
  try {
    storage().setItem(key, value);
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

const inAppBannerKey = 'la-pince:in-app-banner-hidden';
let hiddenInMemory = false;

/**
 * Whether the banner of a browser built into an app was hidden: kept for the page's session, so that it does not come back at each screen, and
 * shown again when a link opens the app anew.
 */
export const wasInAppBannerHidden = (): boolean => hiddenInMemory || read(inAppBannerKey, () => sessionStorage) !== undefined;
export const hideInAppBanner = (): void => {
  hiddenInMemory ||= !write(inAppBannerKey, '1', () => sessionStorage);
};
