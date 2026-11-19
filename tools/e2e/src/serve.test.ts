import { describe, expect, it } from 'vitest';

import { fileFor } from './serve.ts';

describe('fileFor', () => {
  it('serves a file of the build, index.html for a route of the app, and nothing outside the build', () => {
    expect(fileFor('/build', '/assets/index-abc.js?v=1')).toBe('/build/assets/index-abc.js');
    expect(fileFor('/build', '/sw.js')).toBe('/build/sw.js');
    expect(fileFor('/build', '/g/some-token/soldes')).toBe('/build/index.html');
    expect(fileFor('/build', '/../../etc/passwd.txt')).toBe('/build/etc/passwd.txt');
    expect(fileFor('/build', '/%2e%2e/%2e%2e/secret.txt')).toBe('/build/secret.txt');
  });
});
