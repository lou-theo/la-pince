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
    const style = document.createElement('style');
    style.textContent = ":root { --color-brand: #f3d9a4; } :root[data-theme='dark'] { --color-brand: #33291c; }";
    document.head.append(style);
    module.chooseTheme('dark');
    expect(bars()).toStrictEqual(['#33291c', '#33291c']);
    module.chooseTheme('light');
    expect(bars()).toStrictEqual(['#f3d9a4', '#f3d9a4']);
  });

  it('takes a choice made in another tab, and tells who listens', async () => {
    phone(false);
    const module = await load();
    module.startTheme();
    const heard = vi.fn();
    const stop = module.subscribeTheme(heard);
    localStorage.setItem('la-pince:theme', 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'la-pince:last-group' }));
    expect(theme()).toBe('light');
    window.dispatchEvent(new StorageEvent('storage', { key: 'la-pince:theme' }));
    expect(theme()).toBe('dark');
    expect(module.currentTheme()).toBe('dark');
    expect(heard).toHaveBeenCalledOnce();
    stop();
    module.chooseTheme('light');
    expect(heard).toHaveBeenCalledOnce();
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
