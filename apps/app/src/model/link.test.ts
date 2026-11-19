import { describe, expect, it } from 'vitest';

import { tokenFromLink } from './link.ts';

const token = 'abcdefghijklmnopqrstuvwxyz_0123456789-AB';

describe('tokenFromLink', () => {
  it('reads the token of a whole link, with or without the site, a trailing slash, a query or a fragment', () => {
    expect(tokenFromLink(`https://la-pince.example/g/${token}`)).toBe(token);
    expect(tokenFromLink(`/g/${token}/`)).toBe(token);
    expect(tokenFromLink(`https://la-pince.example/g/${token}?from=chat#top`)).toBe(token);
    expect(tokenFromLink(`https://la-pince.example/g/${token}/balances`)).toBe(token);
  });

  it('takes the token alone, around spaces left by a copy', () => {
    expect(tokenFromLink(`  ${token}\n`)).toBe(token);
  });

  it('refuses a text that holds no token: too short, foreign characters, empty', () => {
    expect(tokenFromLink('https://la-pince.example/g/short')).toBeUndefined();
    expect(tokenFromLink(`https://la-pince.example/g/${token.slice(0, 20)}é${token.slice(20)}`)).toBeUndefined();
    expect(tokenFromLink('https://la-pince.example/')).toBeUndefined();
    expect(tokenFromLink('https://la-pince.example/g/')).toBeUndefined();
    expect(tokenFromLink('')).toBeUndefined();
  });
});
