import { memberIdSchema } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { change } from '../testing/fake-server.ts';
import { liveOperations } from './group.ts';
import { byDay, myPart } from './listing.ts';

const me = memberIdSchema.parse('m2');

const operation = (fields: Parameters<typeof change>[0]) => {
  const [live] = liveOperations([change(fields)]);
  if (live === undefined) {
    throw new Error('a live operation');
  }
  return live;
};

describe('myPart', () => {
  it('says what an expense puts on me: my share when another paid, what the others owe when I paid', () => {
    const lines = [
      ['m1', 1_000],
      ['m2', 2_000],
    ] as const;
    expect(myPart(operation({ id: 'a', date: '2026-11-01', payer: 'm1', lines }), me)).toStrictEqual({ kind: 'owe', amount: 2_000 });
    expect(myPart(operation({ id: 'b', date: '2026-11-01', payer: 'm2', lines }), me)).toStrictEqual({ kind: 'advanced', amount: 1_000 });
    // Paying for the others without a share is advancing all of it.
    expect(myPart(operation({ id: 'c', date: '2026-11-01', payer: 'm2', lines: [['m1', 700]] }), me)).toStrictEqual({
      kind: 'advanced',
      amount: 700,
    });
    expect(myPart(operation({ id: 'd', date: '2026-11-01', payer: 'm2', lines: [['m2', 450]] }), me)).toStrictEqual({ kind: 'own', amount: 450 });
    expect(myPart(operation({ id: 'e', date: '2026-11-01', payer: 'm1', lines: [['m3', 450]] }), me)).toStrictEqual({ kind: 'not_involved' });
  });

  it('says what a reimbursement does for me: received, sent, or nothing', () => {
    const reimbursement = (payer: string, lines: readonly (readonly [string, number])[]) =>
      operation({ id: 'r', date: '2026-11-01', kind: 'reimbursement', payer, lines });
    expect(myPart(reimbursement('m1', [['m2', 500]]), me)).toStrictEqual({ kind: 'received', amount: 500 });
    // To several members, I received my line only.
    expect(
      myPart(
        reimbursement('m1', [
          ['m2', 300],
          ['m3', 200],
        ]),
        me,
      ),
    ).toStrictEqual({ kind: 'received', amount: 300 });
    expect(myPart(reimbursement('m2', [['m1', 500]]), me)).toStrictEqual({ kind: 'sent', amount: 500 });
    expect(myPart(reimbursement('m1', [['m3', 500]]), me)).toStrictEqual({ kind: 'not_involved' });
  });
});

describe('byDay', () => {
  it('cuts the list into runs of the same day, keeping its order', () => {
    const days = byDay([
      { id: 'a', date: '2026-11-03' },
      { id: 'b', date: '2026-11-03' },
      { id: 'c', date: '2026-11-01' },
    ]);
    expect(days.map(({ day, operations }) => [day, operations.map((one) => one.id)])).toStrictEqual([
      ['2026-11-03', ['a', 'b']],
      ['2026-11-01', ['c']],
    ]);
    expect(byDay([])).toStrictEqual([]);
  });
});
