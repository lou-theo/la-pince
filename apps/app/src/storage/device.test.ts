import { afterEach, describe, expect, it, vi } from 'vitest';

import { readCurrentMember, readLastGroup, saveCurrentMember, saveLastGroup } from './device.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('device storage', () => {
  it('remembers the last group, and who I am in each group apart', () => {
    saveLastGroup('token-a');
    saveCurrentMember('token-a', 'm1');
    saveCurrentMember('token-b', 'm2');
    expect(readLastGroup()).toBe('token-a');
    expect(readCurrentMember('token-a')).toBe('m1');
    expect(readCurrentMember('token-b')).toBe('m2');
    expect(readCurrentMember('token-c')).toBeUndefined();
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
