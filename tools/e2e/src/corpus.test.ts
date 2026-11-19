import { computeBalances, computeEffect, convertTricount } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { demoGroup } from './corpus.ts';

const balancesOf = (data: unknown) => {
  const group = convertTricount(data);
  const byName = new Map(group.members.map((member) => [member.id, member.name]));
  return new Map(
    [...computeBalances(group.operations.map((operation) => computeEffect(operation.id, operation.entry)))].map(([member, balance]) => [
      byName.get(member),
      balance,
    ]),
  );
};

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
