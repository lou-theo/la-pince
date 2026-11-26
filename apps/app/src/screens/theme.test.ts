import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The phone's theme, which a test turns dark or light, telling the page as a browser does.
function phone(darkAtFirst: boolean) {
  let dark = darkAtFirst;
  const listeners: (() => void)[] = [];
  const query = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, listener: () => void) => listeners.push(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return (next: boolean) => {
    dark = next;
    for (const listener of listeners) {
      listener();
    }
  };
}

// A fresh module per test: the choice it keeps for the page must not leak into the next test.
const load = async () => {
  vi.resetModules();
  return import('./theme.ts');
};
const theme = () => document.documentElement.dataset.theme;
const bars = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => meta.content);

beforeEach(() => {
  document.head.innerHTML =
    '<meta name="theme-color" content="#f3d9a4" media="(prefers-color-scheme: light)" /><meta name="theme-color" content="#33291c" media="(prefers-color-scheme: dark)" />';
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

describe('theme', () => {
  it("follows the phone's theme until one is chosen, then keeps it on the next visit", async () => {
    const turn = phone(false);
    let module = await load();
    module.startTheme();
    expect(module.currentTheme()).toBe('system');
    expect(theme()).toBe('light');
    turn(true);
    expect(theme()).toBe('dark');

    module.chooseTheme('light');
    expect(theme()).toBe('light');
    turn(false);
    turn(true);
    expect(theme()).toBe('light');

    module = await load();
    module.startTheme();
    expect(module.currentTheme()).toBe('light');
    expect(theme()).toBe('light');
    module.chooseTheme('system');
    expect(theme()).toBe('dark');
  });

  it("gives both bars the band's color of the theme shown, whatever the phone's", async () => {
    phone(false);
    const module = await load();
    document.documentElement.style.setProperty('--color-brand', '#33291c');
    module.chooseTheme('dark');
    expect(bars()).toStrictEqual(['#33291c', '#33291c']);
  });

  it('keeps the choice for the page when the browser refuses storage', async () => {
    const refuse = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse });
    const turn = phone(false);
    const module = await load();
    module.startTheme();
    module.chooseTheme('dark');
    turn(true);
    turn(false);
    expect(theme()).toBe('dark');
  });
});
