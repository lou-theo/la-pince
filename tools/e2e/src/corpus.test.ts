import { convertTricount } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { balancesByName as balancesOf, demoGroup } from './corpus.ts';

describe('demoGroup', () => {
  it('draws every identifier again, the same for the same salt, keeping names, amounts and balances', () => {
    const original = convertTricount(demoGroup('a'));
    const other = convertTricount(demoGroup('b'));
    expect(convertTricount(demoGroup('a'))).toStrictEqual(original);
    expect(other.id).not.toBe(original.id);
    expect(other.members.map((member) => member.name)).toStrictEqual(original.members.map((member) => member.name));
    expect(new Set([...original.members, ...other.members].map((member) => member.id)).size).toBe(original.members.length * 2);
    expect(new Set([...original.operations, ...other.operations].map((operation) => operation.id)).size).toBe(original.operations.length * 2);
    expect(balancesOf(demoGroup('b'))).toStrictEqual(balancesOf(demoGroup('a')));
  });

  it('gives the balances of the corpus as computed outside this code', () => {
    // From the test of the conversion in the core, itself checked against a computation made outside the repo.
    expect(Object.fromEntries(balancesOf(demoGroup('a')))).toStrictEqual({
      Agathe: -9910,
      Basile: 4576,
      Capucine: -5541,
      Désiré: -4690,
      Eulalie: 6680,
      Firmin: -300,
      Gaspard: 13923,
      Honorine: -2499,
      Isidore: -384,
      Joséphine: 3548,
      Léandre: -4092,
      Mélusine: -1,
      Octave: 0,
      Philibert: -1310,
    });
  });

  it('repeats each operation under new identifiers, balances multiplied as much', () => {
    const single = convertTricount(demoGroup('a'));
    const tenfold = convertTricount(demoGroup('a', 10));
    expect(tenfold.operations).toHaveLength(single.operations.length * 10);
    expect(new Set(tenfold.operations.map((operation) => operation.id)).size).toBe(tenfold.operations.length);
    const once = balancesOf(demoGroup('a'));
    for (const [name, balance] of balancesOf(demoGroup('a', 10))) {
      expect(balance).toBe((once.get(name) ?? 0) * 10);
    }
  });
});
