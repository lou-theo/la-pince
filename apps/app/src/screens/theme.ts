import { readTheme, saveTheme, type ThemeChoice } from '../storage/device.ts';

const darkQuery = '(prefers-color-scheme: dark)';

// Kept here too, for a browser that refuses storage: the choice then lasts for the page.
let current: ThemeChoice | undefined;

/** The theme chosen on this phone. */
export const currentTheme = (): ThemeChoice => (current ??= readTheme());

/**
 * Sets the theme of the page: `data-theme` on the root, which the styles read, and the color of the browser's bar, the header band's. Both
 * `theme-color` tags take it whatever their `media`: a chosen theme may differ from the phone's, and a browser may read the first tag only.
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

/** Applies the theme chosen on this phone, and follows the phone's while it is the one chosen. */
export function startTheme(): void {
  apply(currentTheme());
  window.matchMedia(darkQuery).addEventListener('change', () => {
    apply(currentTheme());
  });
}

export function chooseTheme(choice: ThemeChoice): void {
  current = choice;
  saveTheme(choice);
  apply(choice);
}
