import { memberSchema } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { change } from '../testing/fake-server.ts';
import { liveOperations, myShare, sortedBalances, transfers } from './group.ts';

const members = ['Alice', 'Bruno', 'Chloé', 'Denis'].map((name, index) => memberSchema.parse({ id: `m${String(index + 1)}`, name }));
const [, bruno, chloe] = members.map((member) => member.id);

describe('liveOperations', () => {
  it('leaves out deleted operations and sorts the latest day first, then the latest entered first', () => {
    const operations = liveOperations([
      change({ id: 'a', date: '2026-11-01', createdSeq: 1 }),
      change({ id: 'b', date: '2026-11-03', createdSeq: 2 }),
      change({ id: 'c', date: '2026-11-01', createdSeq: 5 }),
      change({ id: 'd', date: '2026-11-02', deleted: true }),
    ]);
    expect(operations.map((operation) => operation.id)).toStrictEqual(['b', 'c', 'a']);
  });

  it('keeps title, day, kind, author and the effect computed from the entry', () => {
    const [reimbursement] = liveOperations([
      change({ id: 'r', date: '2026-11-04', kind: 'reimbursement', payer: 'm2', lines: [['m1', 2_500]], author: 'm2' }),
    ]);
    expect(reimbursement).toMatchObject({ id: 'r', title: 'Opération r', date: '2026-11-04', kind: 'reimbursement', author: 'm2' });
    expect(reimbursement?.effect).toStrictEqual({ payer: 'm2', countsAsSpending: false, total: 2_500, shares: [{ member: 'm1', amount: 2_500 }] });
  });
});

describe('myShare', () => {
  it('reads my share of an operation, 0 when I am not involved', () => {
    const [operation] = liveOperations([
      change({
        id: 'x',
        date: '2026-11-01',
        lines: [
          ['m1', 700],
          ['m2', 300],
        ],
      }),
    ]);
    if (operation === undefined || bruno === undefined || chloe === undefined) {
      throw new Error('one operation, four members');
    }
    expect(myShare(operation.effect, bruno)).toBe(300);
    expect(myShare(operation.effect, chloe)).toBe(0);
  });
});

describe('sortedBalances and transfers', () => {
  const operations = liveOperations([
    // Alice pays 90 € for Alice, Bruno and Chloé; Bruno pays 30 € for Chloé alone.
    change({
      id: 'p',
      date: '2026-11-01',
      payer: 'm1',
      lines: [
        ['m1', 3_000],
        ['m2', 3_000],
        ['m3', 3_000],
      ],
    }),
    change({ id: 'q', date: '2026-11-02', payer: 'm2', lines: [['m3', 3_000]] }),
  ]);

  it('gives every member a balance, the largest first, members at 0 in the order they were added', () => {
    expect(sortedBalances(members, operations).map(({ member, balance }) => [member.name, balance])).toStrictEqual([
      ['Alice', 6_000],
      ['Bruno', 0],
      ['Denis', 0],
      ['Chloé', -6_000],
    ]);
  });

  it('keeps a member missing from the list under their identifier, so that the balances still sum to zero', () => {
    const lines = sortedBalances(members.slice(0, 2), operations);
    expect(lines.map(({ member, balance }) => [member.name, balance])).toStrictEqual([
      ['Alice', 6_000],
      ['Bruno', 0],
      ['m3', -6_000],
    ]);
    expect(lines.reduce((sum, line) => sum + line.balance, 0)).toBe(0);
  });

  it('suggests the transfers that bring the balances to zero, none for an empty group', () => {
    expect(transfers(sortedBalances(members, operations))).toStrictEqual([{ from: 'm3', to: 'm1', amount: 6_000 }]);
    expect(transfers(sortedBalances(members, []))).toStrictEqual([]);
  });
});
