// Cases marked “Spliit” are adapted from Spliit (https://github.com/spliit-app/spliit, src/lib/balances.test.ts at commit f293974),
// MIT License, Copyright (c) 2023 Sebastien Castiel.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type Balance, computeBalances } from './balances.ts';
import { computeEffect, type Effect } from './effect.ts';
import { entrySchema } from './entry.ts';
import { type MemberId, memberIdSchema, operationIdSchema } from './ids.ts';
import { type SuggestedTransfer, suggestTransfers } from './transfers.ts';

const evenly = (operationId: string, payer: string, total: number, members: string[]): Effect =>
  computeEffect(
    operationIdSchema.parse(operationId),
    entrySchema.parse({ version: 1, kind: 'expense', payer, total, lines: members.map((member) => ({ member, weight: 1 })) }),
  );
const recorded = (transfers: SuggestedTransfer[]): Effect[] =>
  transfers.map(({ from, to, amount }, index) =>
    computeEffect(
      operationIdSchema.parse(`transfer-${String(index)}`),
      entrySchema.parse({ version: 1, kind: 'reimbursement', payer: from, lines: [{ member: to, amount }] }),
    ),
  );
const balancesOf = (entries: [string, number][]): Map<MemberId, Balance> =>
  new Map(entries.map(([member, balance]) => [memberIdSchema.parse(member), balance]));
const apply = (balances: Map<MemberId, Balance>, transfers: SuggestedTransfer[]): Map<MemberId, Balance> => {
  const after = new Map(balances);
  for (const { from, to, amount } of transfers) {
    after.set(from, (after.get(from) ?? 0) + amount);
    after.set(to, (after.get(to) ?? 0) - amount);
  }
  return after;
};

describe('suggestTransfers', () => {
  it('brings every balance to zero once the suggestions are recorded (Spliit)', () => {
    const expenses = [
      evenly('e1', 'alice', 500000, ['alice', 'bob', 'carol']),
      evenly('e2', 'bob', 12345, ['alice', 'bob', 'carol']),
      evenly('e3', 'carol', 999, ['alice', 'bob']),
    ];
    const transfers = suggestTransfers(computeBalances(expenses));
    expect(transfers.length).toBeGreaterThan(0);
    expect([...computeBalances([...expenses, ...recorded(transfers)]).values()].every((balance) => balance === 0)).toBe(true);
  });

  it('leaves no further transfer to suggest once they are recorded (Spliit)', () => {
    const expenses = [evenly('e1', 'alice', 7777, ['alice', 'bob'])];
    const transfers = suggestTransfers(computeBalances(expenses));
    expect(suggestTransfers(computeBalances([...expenses, ...recorded(transfers)]))).toStrictEqual([]);
  });

  it('pairs the first creditor with the last debtor, by member id', () => {
    const balances = balancesOf([
      ['alice', 3000],
      ['bob', 1000],
      ['carol', -1000],
      ['dave', -3000],
    ]);
    expect(suggestTransfers(balances)).toStrictEqual([
      { from: 'dave', to: 'alice', amount: 3000 },
      { from: 'carol', to: 'bob', amount: 1000 },
    ]);
  });

  it('suggests nothing when everyone is settled', () => {
    expect(suggestTransfers(balancesOf([['alice', 0]]))).toStrictEqual([]);
  });

  it('refuses balances that do not sum to zero', () => {
    expect(() => suggestTransfers(balancesOf([['alice', 1]]))).toThrow('Balances must sum to zero.');
  });

  const members = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'heidi', 'ivan', 'judy', 'mallory', 'oscar', 'peggy'];
  const balances = fc
    .uniqueArray(fc.constantFrom(...members), { minLength: 1, maxLength: members.length })
    .chain((ids) =>
      fc.tuple(fc.constant(ids), fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { minLength: ids.length - 1, maxLength: ids.length - 1 })),
    )
    .map(([ids, values]) =>
      balancesOf(ids.map((member, index) => [member, index < values.length ? (values[index] ?? 0) : -values.reduce((sum, value) => sum + value, 0)])),
    );

  it('settles everyone in at most one transfer fewer than the members owed or owing', () => {
    fc.assert(
      fc.property(balances, (generated) => {
        const transfers = suggestTransfers(generated);
        expect([...apply(generated, transfers).values()].every((balance) => balance === 0)).toBe(true);
        expect(transfers.every((transfer) => Number.isInteger(transfer.amount) && transfer.amount > 0)).toBe(true);
        const open = [...generated.values()].filter((balance) => balance !== 0).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(open - 1, 0));
      }),
    );
  });

  it('keeps the other suggestions once any one of them is recorded', () => {
    fc.assert(
      fc.property(balances, fc.nat(), (generated, pick) => {
        const transfers = suggestTransfers(generated);
        fc.pre(transfers.length > 0);
        const done = transfers[pick % transfers.length];
        if (done === undefined) {
          return;
        }
        expect(suggestTransfers(apply(generated, [done]))).toStrictEqual(transfers.filter((transfer) => transfer !== done));
      }),
    );
  });
});
