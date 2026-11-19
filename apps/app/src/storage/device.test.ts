import { afterEach, describe, expect, it, vi } from 'vitest';

import { readLastGroup, saveLastGroup } from './device.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('device storage', () => {
  it('remembers the last group', () => {
    expect(readLastGroup()).toBeUndefined();
    saveLastGroup('token-a');
    expect(readLastGroup()).toBe('token-a');
  });

  it('forgets rather than fails when the browser refuses storage', () => {
    const refuse = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse });
    expect(() => {
      saveLastGroup('token-a');
    }).not.toThrow();
    expect(readLastGroup()).toBeUndefined();
  });
});
