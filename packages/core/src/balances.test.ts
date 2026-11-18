// Cases marked “Spliit” are adapted from Spliit (https://github.com/spliit-app/spliit, src/lib/balances.test.ts at commit f293974),
// MIT License, Copyright (c) 2023 Sebastien Castiel.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { computeBalances } from './balances.ts';
import { computeEffect, type Effect } from './effect.ts';
import { entrySchema } from './entry.ts';
import { operationIdSchema } from './ids.ts';

const evenly = (operationId: string, payer: string, total: number, members: string[], kind = 'expense'): Effect =>
  computeEffect(
    operationIdSchema.parse(operationId),
    entrySchema.parse({ version: 1, kind, payer, total, lines: members.map((member) => ({ member, weight: 1 })) }),
  );

describe('computeBalances', () => {
  it('splits an expense evenly between the members involved (Spliit)', () => {
    expect(computeBalances([evenly('e1', 'alice', 3000, ['alice', 'bob'])])).toStrictEqual(
      new Map([
        ['alice', 1500],
        ['bob', -1500],
      ]),
    );
  });

  it('counts a reimbursement like any other operation (Spliit)', () => {
    const balances = computeBalances([evenly('e1', 'alice', 3000, ['alice', 'bob']), evenly('r1', 'bob', 1500, ['alice'], 'reimbursement')]);
    expect([...balances.values()]).toStrictEqual([0, 0]);
  });

  it('sums to zero for an expense split seven ways (Spliit)', () => {
    const balances = computeBalances([evenly('e1', 'alice', 10000, ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace'])]);
    expect([...balances.values()].reduce((sum, balance) => sum + balance, 0)).toBe(0);
  });

  it('has no balance without operations', () => {
    expect(computeBalances([])).toStrictEqual(new Map());
  });

  const members = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank'];
  const effects = fc.array(
    fc.record({
      operationId: fc.uuid(),
      payer: fc.constantFrom(...members),
      total: fc.integer({ min: 1, max: 10_000_000 }),
      involved: fc.uniqueArray(fc.constantFrom(...members), { minLength: 1 }),
    }),
    { maxLength: 50 },
  );

  it('always sums to zero, each balance being what the member paid minus their shares', () => {
    fc.assert(
      fc.property(effects, (generated) => {
        const computed = generated.map(({ operationId, payer, total, involved }) => evenly(operationId, payer, total, involved));
        const balances = computeBalances(computed);
        expect([...balances.values()].reduce((sum, balance) => sum + balance, 0)).toBe(0);
        for (const [member, balance] of balances) {
          const paid = computed.filter((effect) => effect.payer === member).reduce((sum, effect) => sum + effect.total, 0);
          const owed = computed
            .flatMap((effect) => effect.shares.filter((share) => share.member === member))
            .reduce((sum, share) => sum + share.amount, 0);
          expect(balance).toBe(paid - owed);
        }
      }),
    );
  });
});
