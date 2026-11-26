import { afterEach, describe, expect, it, vi } from 'vitest';

import { hideInAppBanner, readLastGroup, rememberInstallOffered, saveLastGroup, wasInAppBannerHidden, wasInstallOffered } from './device.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('device storage', () => {
  it('remembers the last group', () => {
    expect(readLastGroup()).toBeUndefined();
    saveLastGroup('token-a');
    expect(readLastGroup()).toBe('token-a');
  });

  it('remembers that the install was offered, across visits', () => {
    expect(wasInstallOffered()).toBe(false);
    rememberInstallOffered();
    expect(localStorage.getItem('la-pince:install-offered')).not.toBeNull();
    expect(wasInstallOffered()).toBe(true);
  });

  it("remembers the banner hidden for the page's session only", () => {
    expect(wasInAppBannerHidden()).toBe(false);
    hideInAppBanner();
    expect(wasInAppBannerHidden()).toBe(true);
    expect(localStorage.length).toBe(0);
    sessionStorage.clear();
    expect(wasInAppBannerHidden()).toBe(false);
  });

  it('forgets rather than fails when the browser refuses storage', () => {
    const refuse = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse });
    vi.stubGlobal('sessionStorage', { getItem: refuse, setItem: refuse });
    expect(() => {
      saveLastGroup('token-a');
    }).not.toThrow();
    expect(readLastGroup()).toBeUndefined();
    // Offered once in this visit all the same, not at each screen.
    expect(wasInstallOffered()).toBe(false);
    rememberInstallOffered();
    expect(wasInstallOffered()).toBe(true);
    hideInAppBanner();
    expect(wasInAppBannerHidden()).toBe(true);
  });
});
