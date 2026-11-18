// Cases marked “Spliit” are adapted from Spliit (https://github.com/spliit-app/spliit, src/lib/shares.test.ts at commit f293974),
// MIT License, Copyright (c) 2023 Sebastien Castiel.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { computeEffect, type Effect } from './effect.ts';
import { type Entry, entrySchema } from './entry.ts';
import { type OperationId, operationIdSchema } from './ids.ts';

type Line = { member: string; amount: number } | { member: string; weight: number };

const id = (value: string): OperationId => operationIdSchema.parse(value);
const entry = (lines: Line[], total?: number): Entry =>
  entrySchema.parse({ version: 1, kind: 'expense', payer: 'alice', lines, ...(total === undefined ? {} : { total }) });
const evenly = (total: number, members: string[]): Entry =>
  entry(
    members.map((member) => ({ member, weight: 1 })),
    total,
  );
const sharesOf = (effect: Effect): Record<string, number> => Object.fromEntries(effect.shares.map((share) => [share.member, share.amount]));
const sorted = (effect: Effect): number[] => effect.shares.map((share) => share.amount).toSorted((a, b) => a - b);

describe('computeEffect', () => {
  it('splits an uneven amount without leaving a cent behind (Spliit)', () => {
    expect(sorted(computeEffect(id('e1'), evenly(9500, ['alice', 'bob', 'carol'])))).toStrictEqual([3166, 3167, 3167]);
  });

  it('splits by weight proportionally (Spliit)', () => {
    const effect = computeEffect(
      id('e1'),
      entry(
        [
          { member: 'alice', weight: 1 },
          { member: 'bob', weight: 2 },
        ],
        100,
      ),
    );
    expect(sharesOf(effect)).toStrictEqual({ alice: 33, bob: 67 });
  });

  it('leaves exact amounts untouched (Spliit)', () => {
    const effect = computeEffect(
      id('e1'),
      entry([
        { member: 'alice', amount: 333 },
        { member: 'bob', amount: 333 },
        { member: 'carol', amount: 334 },
      ]),
    );
    expect(effect).toStrictEqual({
      payer: 'alice',
      total: 1000,
      shares: [
        { member: 'alice', amount: 333 },
        { member: 'bob', amount: 333 },
        { member: 'carol', amount: 334 },
      ],
    });
  });

  it('does not depend on the order of the lines (Spliit)', () => {
    expect(computeEffect(id('e1'), evenly(100, ['carol', 'bob', 'alice']))).toStrictEqual(
      computeEffect(id('e1'), evenly(100, ['alice', 'bob', 'carol'])),
    );
  });

  it('does not always give the leftover cent to the same member (Spliit)', () => {
    const receivers = new Set<string>();
    for (let index = 0; index < 50; index++) {
      const effect = computeEffect(id(`expense-${String(index)}`), evenly(100, ['alice', 'bob', 'carol']));
      for (const share of effect.shares) {
        if (share.amount === 34) {
          receivers.add(share.member);
        }
      }
    }
    expect(receivers).toStrictEqual(new Set(['alice', 'bob', 'carol']));
  });

  it('shares what the fixed amounts leave between the weighted lines', () => {
    const effect = computeEffect(
      id('e1'),
      entry(
        [
          { member: 'alice', amount: 1000 },
          { member: 'bob', weight: 1 },
          { member: 'carol', weight: 3 },
        ],
        3000,
      ),
    );
    expect(sharesOf(effect)).toStrictEqual({ alice: 1000, bob: 500, carol: 1500 });
  });

  it('leaves out a member whose weighted share rounds down to zero', () => {
    const effect = computeEffect(
      id('e1'),
      entry(
        [
          { member: 'alice', amount: 100 },
          { member: 'bob', weight: 1 },
          { member: 'carol', weight: 1 },
        ],
        101,
      ),
    );
    expect(effect.shares).toHaveLength(2);
    expect(effect.shares.reduce((sum, share) => sum + share.amount, 0)).toBe(101);
  });

  it('gives a reimbursement its whole amount to the member reimbursed', () => {
    const reimbursement = entrySchema.parse({ version: 1, kind: 'reimbursement', payer: 'bob', lines: [{ member: 'alice', amount: 1500 }] });
    expect(computeEffect(id('r1'), reimbursement)).toStrictEqual({ payer: 'bob', total: 1500, shares: [{ member: 'alice', amount: 1500 }] });
  });

  const members = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'heidi', 'ivan', 'judy', 'mallory', 'oscar', 'peggy'];
  const lines = fc.uniqueArray(
    fc.record({
      member: fc.constantFrom(...members),
      share: fc.oneof(fc.record({ amount: fc.integer({ min: 1, max: 1_000_000 }) }), fc.record({ weight: fc.integer({ min: 1, max: 1_000 }) })),
    }),
    { minLength: 1, maxLength: members.length, selector: (line) => line.member },
  );
  const entries = fc
    .tuple(
      lines.map((generated) => generated.map(({ member, share }): Line => ({ member, ...share }))),
      fc.integer({ min: 1, max: 100_000_000 }),
    )
    .map(([generated, extra]) => {
      const fixed = generated.reduce((sum, line) => sum + ('amount' in line ? line.amount : 0), 0);
      return { lines: generated, entry: entry(generated, generated.some((line) => 'weight' in line) ? fixed + extra : undefined) };
    });
  const operationIds = fc.string({ minLength: 1 }).map(id);

  it('always splits the whole total into positive whole cents, one share per member at most', () => {
    fc.assert(
      fc.property(operationIds, entries, (operationId, generated) => {
        const effect = computeEffect(operationId, generated.entry);
        expect(effect.shares.reduce((sum, share) => sum + share.amount, 0)).toBe(effect.total);
        expect(effect.shares.every((share) => Number.isInteger(share.amount) && share.amount > 0)).toBe(true);
        const ids = effect.shares.map((share) => share.member);
        expect(ids).toStrictEqual([...new Set(ids)].toSorted());
      }),
    );
  });

  it('keeps every fixed amount and gives every weighted line its exact share rounded down or up', () => {
    fc.assert(
      fc.property(operationIds, entries, (operationId, generated) => {
        const effect = computeEffect(operationId, generated.entry);
        const shares = sharesOf(effect);
        const fixed = generated.lines.reduce((sum, line) => sum + ('amount' in line ? line.amount : 0), 0);
        const totalWeight = generated.lines.reduce((sum, line) => sum + ('weight' in line ? line.weight : 0), 0);
        for (const line of generated.lines) {
          const exact = 'amount' in line ? line.amount : ((effect.total - fixed) * line.weight) / totalWeight;
          expect(shares[line.member] ?? 0).toBeOneOf([Math.floor(exact), Math.ceil(exact)]);
        }
      }),
    );
  });

  it('gives the same effect whatever the order of the lines', () => {
    fc.assert(
      fc.property(
        operationIds,
        entries.chain((generated) => fc.tuple(fc.constant(generated), fc.shuffledSubarray(generated.lines, { minLength: generated.lines.length }))),
        (operationId, [generated, shuffled]) => {
          const reordered = entrySchema.parse({ ...generated.entry, lines: shuffled });
          expect(computeEffect(operationId, reordered)).toStrictEqual(computeEffect(operationId, generated.entry));
        },
      ),
    );
  });
});
