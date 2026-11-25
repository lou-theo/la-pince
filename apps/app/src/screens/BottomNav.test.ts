import { describe, expect, it } from 'vitest';

import { chromeOf } from './BottomNav.tsx';

const frame = (path: string) => {
  const { section, nav, screenBar } = chromeOf(path);
  return [section, nav ? 'menu' : 'no menu', screenBar ? 'own bar' : 'group band'];
};

describe('chromeOf', () => {
  it('keeps the menu under its two tabs, the transfers with their own bar, with or without a trailing slash', () => {
    expect(['/', '/operations/op-1', '/soldesx', '/soldes', '/soldes/', '/soldes/virements', '/soldes/virements/'].map(frame)).toStrictEqual([
      ['operations', 'menu', 'group band'],
      ['operations', 'menu', 'group band'],
      ['operations', 'menu', 'group band'],
      ['balances', 'menu', 'group band'],
      ['balances', 'menu', 'group band'],
      ['balances', 'menu', 'own bar'],
      ['balances', 'menu', 'own bar'],
    ]);
  });

  it('gives my page, a sheet and the forms the whole screen with their own bar', () => {
    expect(
      [
        '/moi',
        '/moi/',
        '/moi/groupe',
        '/membres/m1',
        '/membres/m1/',
        '/nouvelle-depense',
        '/nouveau-remboursement/',
        '/operations/op-1/modifier',
      ].map(frame),
    ).toStrictEqual([
      ['me', 'no menu', 'own bar'],
      ['me', 'no menu', 'own bar'],
      ['members', 'no menu', 'own bar'],
      ['sheet', 'no menu', 'own bar'],
      ['sheet', 'no menu', 'own bar'],
      ['form', 'no menu', 'own bar'],
      ['form', 'no menu', 'own bar'],
      ['form', 'no menu', 'own bar'],
    ]);
  });

  it('keeps the group band on an unknown path, nothing filling a screen bar', () => {
    expect(['/soldes/xyz', '/soldes/membres/m1', '/membres', '/membres/m1/x', '/moi/x', '/soldes/virements//'].map(frame)).toStrictEqual([
      ['balances', 'menu', 'group band'],
      ['balances', 'menu', 'group band'],
      ['operations', 'menu', 'group band'],
      ['operations', 'menu', 'group band'],
      ['operations', 'menu', 'group band'],
      ['balances', 'menu', 'group band'],
    ]);
  });
});
