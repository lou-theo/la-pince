import { type Member, memberIdSchema, memberSchema, type SuggestedTransfer, suggestTransfers } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { decorScale, decorSize, memberSheet, standing, transfersByDebtor } from './balances.ts';
import type { BalanceLine } from './group.ts';

const membersOf = (count: number): Member[] =>
  Array.from({ length: count }, (_, index) => memberSchema.parse({ id: `m${String(index + 1)}`, name: `Membre ${String(index + 1)}` }));
const lines = (members: readonly Member[], balances: readonly number[]): BalanceLine[] =>
  members.map((member, index) => ({ member, balance: balances[index] ?? 0 }));
const id = (value: string) => memberIdSchema.parse(value);
const transfer = (from: string, to: string, amount: number) => ({ from, to, amount }) as SuggestedTransfer;

// Balances of the demo group, in its order of addition, summing to zero.
const demoBalances = [0, 6_850, -907, 3_548, -3_597, -1_499, -575, 1, -3_390, 2_602, -1_555, -1, -1_477];
const demo = membersOf(demoBalances.length);
const demoLines = lines(demo, demoBalances);
const demoTransfers = suggestTransfers(new Map(demoLines.map((line) => [line.member.id, line.balance])));

describe('standing', () => {
  it('tells who the group owes, who owes the group, and who is settled, from the cent', () => {
    expect([1, -1, 0].map(standing)).toStrictEqual(['ahead', 'owes', 'settled']);
  });
});

describe('transfersByDebtor', () => {
  it('groups every transfer under its debtor, whose total is their debt to the cent', () => {
    const grouped = transfersByDebtor(demoTransfers, demo);
    const key = ({ from, to, amount }: SuggestedTransfer) => `${from}>${to}:${String(amount)}`;
    expect(grouped.flatMap((debtor) => debtor.transfers.map(key)).sort()).toStrictEqual(demoTransfers.map(key).sort());
    for (const { debtor, total } of grouped) {
      expect(total).toBe(-(demoLines.find((line) => line.member.id === debtor)?.balance ?? 0));
    }
    expect(grouped.map((debtor) => debtor.debtor)).toStrictEqual(['m5', 'm9', 'm11', 'm6', 'm13', 'm3', 'm7', 'm12']);
  });

  it('puts the largest debt first and, within a debt, the largest transfer first', () => {
    const grouped = transfersByDebtor(
      [transfer('m1', 'm4', 100), transfer('m2', 'm4', 50), transfer('m1', 'm3', 300), transfer('m2', 'm3', 600)],
      membersOf(4),
    );
    expect(grouped).toStrictEqual([
      { debtor: 'm2', total: 650, transfers: [transfer('m2', 'm3', 600), transfer('m2', 'm4', 50)] },
      { debtor: 'm1', total: 400, transfers: [transfer('m1', 'm3', 300), transfer('m1', 'm4', 100)] },
    ]);
  });

  it('breaks ties in the order members were added, a member missing from the list last', () => {
    const members = membersOf(3).toReversed();
    const grouped = transfersByDebtor(
      [transfer('m1', 'gone', 100), transfer('m1', 'm2', 100), transfer('gone', 'm2', 200), transfer('m3', 'm2', 200)],
      members,
    );
    expect(grouped.map((debtor) => debtor.debtor)).toStrictEqual(['m3', 'm1', 'gone']);
    expect(grouped[1]?.transfers.map((line) => line.to)).toStrictEqual(['m2', 'gone']);
  });

  it('has nothing for a settled group', () => {
    expect(transfersByDebtor([], membersOf(2))).toStrictEqual([]);
  });
});

describe('memberSheet', () => {
  it('lists what a debtor pays, the largest first', () => {
    const sheet = memberSheet(id('m5'), demoLines, demoTransfers, demo);
    expect(sheet?.balance).toBe(-3_597);
    expect(sheet?.standing).toBe('owes');
    expect(sheet?.receives).toStrictEqual([]);
    expect(sheet?.pays.map((line) => line.amount)).toStrictEqual([...(sheet?.pays.map((line) => line.amount) ?? [])].sort((a, b) => b - a));
    expect(sheet?.pays.reduce((sum, line) => sum + line.amount, 0)).toBe(3_597);
  });

  it('lists who pays a member the group owes, the largest first, ties in the order of addition', () => {
    const members = membersOf(4);
    const sheet = memberSheet(
      id('m1'),
      lines(members, [400, -100, -100, -200]),
      [transfer('m3', 'm1', 100), transfer('m4', 'm1', 200), transfer('m2', 'm1', 100)],
      members,
    );
    expect(sheet).toStrictEqual({
      balance: 400,
      standing: 'ahead',
      pays: [],
      receives: [transfer('m4', 'm1', 200), transfer('m2', 'm1', 100), transfer('m3', 'm1', 100)],
    });
  });

  it('has nothing to pay or receive for a settled member, and no sheet for an unknown one', () => {
    expect(memberSheet(id('m1'), demoLines, demoTransfers, demo)).toStrictEqual({ balance: 0, standing: 'settled', pays: [], receives: [] });
    expect(memberSheet(id('m99'), demoLines, demoTransfers, demo)).toBeUndefined();
  });
});

describe('decor', () => {
  it('scales on the largest balance in absolute value, a debt included', () => {
    const members = membersOf(2);
    expect(decorScale(demoLines)).toBe(6_850);
    expect(decorScale(lines(members, [6_000, -9_000]))).toBe(9_000);
  });

  it('keeps small bags for a group of small balances, and the floor for a settled or empty group', () => {
    expect(decorScale(lines(membersOf(2), [1_000, -1_000]))).toBe(5_000);
    expect(decorScale([])).toBe(5_000);
    expect(decorSize(1_000, 5_000)).toBe(14);
  });

  it('grows from a readable size to the largest, the same for a bag and a ball', () => {
    expect(decorSize(1, 6_850)).toBe(12);
    expect(decorSize(6_850, 6_850)).toBe(24);
    expect(decorSize(-6_850, 6_850)).toBe(24);
    expect(decorSize(-3_597, 6_850)).toBe(18);
    // Never beyond the largest, whatever is asked.
    expect(decorSize(10_000, 6_850)).toBe(24);
  });
});
