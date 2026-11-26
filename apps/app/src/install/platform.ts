import type { InstallEnvironment, PromptState } from '../model/install.ts';

/** Chromium's install window, held from `beforeinstallprompt` until the person asks for it; absent from the DOM types. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<unknown>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

/** What came of a request to install: the person's answer in the browser's window, `unavailable` when no window is held. */
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

/** The browser's APIs the install offer uses, so that tests hand it a fake one. */
export interface InstallPlatform {
  readonly environment: () => InstallEnvironment;
  readonly prompt: () => PromptState;
  /** Calls `listener` at each change of `prompt()`; returns the way to stop. */
  readonly onPromptChange: (listener: () => void) => () => void;
  /** Opens the browser's install window, which only a gesture of the person may do. */
  readonly install: () => Promise<InstallOutcome>;
}

// Chromium sends `beforeinstallprompt` once the page qualifies, without a set moment: a little after the service worker takes control on a first
// visit, never where the app is already installed.
const promptWait = 3000;

let held: BeforeInstallPromptEvent | undefined;
let state: PromptState = 'waiting';
let capturing = false;
const listeners = new Set<() => void>();

function set(next: PromptState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Holds Chromium's install window from the start of the page, before React renders: the event may come before any screen listens. Holding it
 * also keeps Chrome from showing its own bar, the app offering the install itself. Called again, it does nothing.
 */
export function captureInstallPrompt(): void {
  if (capturing) {
    return;
  }
  capturing = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    held = event as BeforeInstallPromptEvent;
    set('available');
  });
  window.addEventListener('appinstalled', () => {
    held = undefined;
    set('absent');
  });
  setTimeout(() => {
    if (state === 'waiting') {
      set('absent');
    }
  }, promptWait);
}

/** The browser's own APIs; the install window is held from the first call of `captureInstallPrompt`, made at the start of the app. */
export function browserInstallPlatform(): InstallPlatform {
  captureInstallPrompt();
  return {
    environment: () => ({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      standalone:
        window.matchMedia('(display-mode: standalone)').matches ||
        // Safari's own flag, for an app opened from the iPhone's home screen.
        (navigator as Navigator & { readonly standalone?: boolean }).standalone === true,
    }),
    prompt: () => state,
    onPromptChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async install() {
      const event = held;
      if (event === undefined) {
        return 'unavailable';
      }
      // A window opens once per event: the next one only comes with a new `beforeinstallprompt`.
      held = undefined;
      set('absent');
      try {
        await event.prompt();
        return (await event.userChoice).outcome;
      } catch {
        // Refused by the browser (no gesture, window already shown).
        return 'unavailable';
      }
    },
  };
}
