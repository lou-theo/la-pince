import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fresh module for each test: the install window it holds belongs to the page.
async function fresh() {
  vi.resetModules();
  return import('./platform.ts');
}

/** Chromium's `beforeinstallprompt`, its window answering `outcome`. */
function promptEvent(outcome: 'accepted' | 'dismissed' | Error) {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompted: 0,
    prompt: () => {
      event.prompted += 1;
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve();
    },
    userChoice: Promise.resolve({ outcome: outcome instanceof Error ? 'dismissed' : outcome }),
  });
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('install window of the browser', () => {
  it('is held from the start, kept from Chrome, and opened once at the request', async () => {
    const { captureInstallPrompt, browserInstallPlatform } = await fresh();
    captureInstallPrompt();
    const platform = browserInstallPlatform();
    const changes = vi.fn();
    const stop = platform.onPromptChange(changes);
    expect(platform.prompt()).toBe('waiting');

    const event = promptEvent('accepted');
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(platform.prompt()).toBe('available');
    expect(changes).toHaveBeenCalledTimes(1);

    expect(await platform.install()).toBe('accepted');
    expect(event.prompted).toBe(1);
    expect(platform.prompt()).toBe('absent');
    // A window opens once per event.
    expect(await platform.install()).toBe('unavailable');
    stop();
    window.dispatchEvent(promptEvent('dismissed'));
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('tells a dismissal, and a window the browser refuses to open', async () => {
    const { browserInstallPlatform } = await fresh();
    const platform = browserInstallPlatform();
    window.dispatchEvent(promptEvent('dismissed'));
    expect(await platform.install()).toBe('dismissed');
    window.dispatchEvent(promptEvent(new Error('no gesture')));
    expect(await platform.install()).toBe('unavailable');
  });

  it('is absent when it does not come within 3 s, or once the app is installed, and may come later', async () => {
    const { browserInstallPlatform } = await fresh();
    const platform = browserInstallPlatform();
    vi.advanceTimersByTime(2999);
    expect(platform.prompt()).toBe('waiting');
    vi.advanceTimersByTime(1);
    expect(platform.prompt()).toBe('absent');
    window.dispatchEvent(promptEvent('accepted'));
    expect(platform.prompt()).toBe('available');
    window.dispatchEvent(new Event('appinstalled'));
    expect(platform.prompt()).toBe('absent');
    expect(await platform.install()).toBe('unavailable');
    vi.advanceTimersByTime(5000);
    expect(platform.prompt()).toBe('absent');
  });

  it('reads the page opened from the home screen, by the display mode or by Safari', async () => {
    const { browserInstallPlatform } = await fresh();
    const platform = browserInstallPlatform();
    expect(platform.environment()).toMatchObject({ userAgent: navigator.userAgent, standalone: false });
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(platform.environment().standalone).toBe(true);
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    expect(platform.environment().standalone).toBe(true);
    Reflect.deleteProperty(navigator, 'standalone');
  });
});
