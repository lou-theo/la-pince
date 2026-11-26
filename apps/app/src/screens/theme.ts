import { readTheme, saveTheme, type ThemeChoice, themeKey } from '../storage/device.ts';

const darkQuery = '(prefers-color-scheme: dark)';

// Kept here too, for a browser that refuses storage: the choice then lasts for the page.
let current: ThemeChoice | undefined;
const listeners = new Set<() => void>();

/** The theme chosen on this phone. */
export const currentTheme = (): ThemeChoice => (current ??= readTheme());

/** Calls `listener` whenever the chosen theme changes, here or in another tab; returns the way to stop. */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Sets the theme of the page: `data-theme` on the root, which the styles read, and the color of the browser's bar, the header band's. Both
 * `theme-color` tags take it whatever their `media`: a chosen theme may differ from the phone's.
 */
function apply(choice: ThemeChoice): void {
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia(darkQuery).matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  const brand = getComputedStyle(root).getPropertyValue('--color-brand').trim();
  if (brand !== '') {
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = brand;
    }
  }
}

function set(choice: ThemeChoice): void {
  current = choice;
  apply(choice);
  for (const listener of listeners) {
    listener();
  }
}

/** Applies the theme chosen on this phone, follows the phone's while it is the one chosen, and a choice made in another tab. */
export function startTheme(): void {
  apply(currentTheme());
  window.matchMedia(darkQuery).addEventListener('change', () => {
    apply(currentTheme());
  });
  window.addEventListener('storage', (event) => {
    if (event.key === themeKey) {
      set(readTheme());
    }
  });
}

export function chooseTheme(choice: ThemeChoice): void {
  saveTheme(choice);
  set(choice);
}
