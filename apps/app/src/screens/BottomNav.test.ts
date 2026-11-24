import { describe, expect, it } from 'vitest';

import { isSubScreen, sectionOf } from './BottomNav.tsx';

describe('sectionOf', () => {
  it('puts the screens under the balances in their tab, with or without a trailing slash', () => {
    expect(['/soldes', '/soldes/', '/soldes/virements/', '/soldes/membres/m1', '/soldes/xyz'].map(sectionOf)).toStrictEqual([
      'balances',
      'balances',
      'balances',
      'balances',
      'balances',
    ]);
    expect(['/', '/soldesx', '/operations/op-1', '/nouveau-remboursement/', '/moi'].map(sectionOf)).toStrictEqual([
      'operations',
      'operations',
      'operations',
      'form',
      'me',
    ]);
  });
});

describe('isSubScreen', () => {
  it('knows the transfers and a member sheet only, an unknown path keeping the group band', () => {
    expect(['/soldes/virements', '/soldes/virements/', '/soldes/membres/m1', '/soldes/membres/m1/'].map(isSubScreen)).toStrictEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(['/soldes', '/soldes/', '/soldes/xyz', '/soldes/membres', '/soldes/membres/m1/x', '/nouvelle-depense'].map(isSubScreen)).toStrictEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
