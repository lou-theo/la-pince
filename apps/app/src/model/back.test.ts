import { memberIdSchema } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { backOf, sheetHref } from './back.ts';

const alice = memberIdSchema.parse('m1');

describe('sheetHref', () => {
  it('links a sheet with the screen its arrow leads back to', () => {
    expect(sheetHref(alice, '/moi/groupe')).toBe('/membres/m1?retour=%2Fmoi%2Fgroupe');
    expect(sheetHref(alice, '/soldes')).toBe('/membres/m1?retour=%2Fsoldes');
  });
});

describe('backOf', () => {
  it('leads a sheet back to the screen it opened from, the balances by default', () => {
    expect(['/soldes', '/soldes/virements', '/moi', '/moi/groupe'].map((retour) => backOf('sheet', retour))).toStrictEqual([
      '/soldes',
      '/soldes/virements',
      '/moi',
      '/moi/groupe',
    ]);
    expect(backOf('sheet', null)).toBe('/soldes');
  });

  it('leads the reimbursement page back to a sheet with its own way back, nested', () => {
    expect(backOf('reimbursement', '/soldes/virements')).toBe('/soldes/virements');
    expect(backOf('reimbursement', '/moi')).toBe('/moi');
    expect(backOf('reimbursement', sheetHref(alice, '/moi/groupe'))).toBe('/membres/m1?retour=%2Fmoi%2Fgroupe');
    // A sheet without its own way back, or with a foreign one, leads back to the balances from there.
    expect(backOf('reimbursement', '/membres/m1')).toBe('/membres/m1?retour=%2Fsoldes');
    expect(backOf('reimbursement', '/membres/m1?retour=%2F%2Fevil.example')).toBe('/membres/m1?retour=%2Fsoldes');
  });

  it('gives the balances for anything outside the group screens, a sheet only from the reimbursement page', () => {
    const hostile = [
      '//evil.example',
      'https://evil.example/soldes',
      '~/lien',
      '/soldes/../lien',
      '/soldes?x=1',
      '/membres/m1/x',
      '/membres/not%20an%20id',
      '/membres/m1#top',
      '',
    ];
    expect(hostile.map((retour) => backOf('reimbursement', retour))).toStrictEqual(hostile.map(() => '/soldes'));
    expect(backOf('sheet', '/membres/m1?retour=%2Fmoi')).toBe('/soldes');
  });
});
