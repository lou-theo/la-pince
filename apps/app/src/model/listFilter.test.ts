import { memberIdSchema } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { change } from '../testing/fake-server.ts';
import { liveOperations } from './group.ts';
import {
  amountBound,
  filterOperations,
  hasAdvanced,
  isActive,
  type ListFilter,
  NO_FILTER,
  normalized,
  paidByMe,
  resultHeading,
  togglePaidByMe,
} from './listFilter.ts';

const m1 = memberIdSchema.parse('m1');
const me = memberIdSchema.parse('m2');
const m3 = memberIdSchema.parse('m3');

// The list, latest first: what each filter keeps is named by the ids.
const operations = liveOperations([
  // Alice paid for the three, 10,00 + 20,00 + 15,00.
  change({
    id: 'shopping',
    date: '2026-11-05',
    title: 'Courses du Marché',
    payer: 'm1',
    lines: [
      ['m1', 1_000],
      ['m2', 2_000],
      ['m3', 1_500],
    ],
  }),
  // I paid for Chloé alone: I advanced it without a share.
  change({ id: 'cinema', date: '2026-11-04', title: 'Cinéma', payer: 'm2', lines: [['m3', 1_200]] }),
  // I paid my own coffee.
  change({ id: 'coffee', date: '2026-11-03', title: 'Café', payer: 'm2', lines: [['m2', 250]] }),
  // Chloé paid for Alice.
  change({ id: 'pizza', date: '2026-11-02', title: 'PIZZA', payer: 'm3', lines: [['m1', 2_000]] }),
  // Chloé paid me back.
  change({ id: 'back', date: '2026-11-01', title: 'Remboursement', kind: 'reimbursement', payer: 'm3', lines: [['m2', 1_200]] }),
]);

const ids = (filter: Partial<ListFilter>) => filterOperations(operations, { ...NO_FILTER, ...filter }, me).map((operation) => operation.id);

describe('filterOperations', () => {
  it('keeps the whole list, in its order, without a filter', () => {
    expect(ids({})).toStrictEqual(['shopping', 'cinema', 'coffee', 'pizza', 'back']);
  });

  it('keeps what I have a share of under « Me concerne », what I paid under « Payé par moi », and whatever involves me under both', () => {
    expect(ids({ involvesMe: true })).toStrictEqual(['shopping', 'coffee', 'back']);
    expect(ids({ payers: [me] })).toStrictEqual(['cinema', 'coffee']);
    // Either: the cinema I advanced without a share comes in.
    expect(ids({ involvesMe: true, payers: [me] })).toStrictEqual(['shopping', 'cinema', 'coffee', 'back']);
    // With other payers, both narrow the list, me among them or not.
    expect(ids({ involvesMe: true, payers: [m1, m3] })).toStrictEqual(['shopping', 'back']);
    expect(ids({ involvesMe: true, payers: [me, m3] })).toStrictEqual(['coffee', 'back']);
  });

  it('keeps any of the payers chosen', () => {
    expect(ids({ payers: [m1, m3] })).toStrictEqual(['shopping', 'pizza', 'back']);
  });

  it('keeps the operations where all the members chosen have a share, or at least one of them', () => {
    expect(ids({ involved: [m1, m3] })).toStrictEqual(['shopping']);
    expect(ids({ involved: [m1, m3], involvedMode: 'any' })).toStrictEqual(['shopping', 'cinema', 'pizza']);
    // A payer without a share is not involved.
    expect(ids({ involved: [m3], involvedMode: 'any' })).toStrictEqual(['shopping', 'cinema']);
  });

  it('keeps one kind of operation', () => {
    expect(ids({ kind: 'reimbursement' })).toStrictEqual(['back']);
    expect(ids({ kind: 'expense' })).toStrictEqual(['shopping', 'cinema', 'coffee', 'pizza']);
  });

  it('finds a part of the title whatever its case and accents', () => {
    expect(ids({ search: ' cinema ' })).toStrictEqual(['cinema']);
    expect(ids({ search: 'Pizza' })).toStrictEqual(['pizza']);
    expect(ids({ search: 'MARCHÉ' })).toStrictEqual(['shopping']);
    expect(ids({ search: 'café' })).toStrictEqual(['coffee']);
    expect(ids({ search: '   ' })).toStrictEqual(ids({}));
  });

  it('bounds the total of the operation to the cent, both bounds included, an unreadable bound being ignored', () => {
    expect(ids({ minAmount: '20' })).toStrictEqual(['shopping', 'pizza']);
    expect(ids({ minAmount: '20,01' })).toStrictEqual(['shopping']);
    expect(ids({ maxAmount: '12' })).toStrictEqual(['cinema', 'coffee', 'back']);
    expect(ids({ maxAmount: '11,99' })).toStrictEqual(['coffee']);
    expect(ids({ minAmount: '2,50', maxAmount: '2,50' })).toStrictEqual(['coffee']);
    expect(ids({ minAmount: '12 €', maxAmount: '20' })).toStrictEqual(['cinema', 'pizza', 'back']);
    expect(ids({ minAmount: 'abc', maxAmount: '1,234' })).toStrictEqual(ids({}));
  });

  it('bounds the day, both bounds included', () => {
    expect(ids({ from: '2026-11-04' })).toStrictEqual(['shopping', 'cinema']);
    expect(ids({ to: '2026-11-02' })).toStrictEqual(['pizza', 'back']);
    expect(ids({ from: '2026-11-03', to: '2026-11-03' })).toStrictEqual(['coffee']);
    // A year of five digits, which a date field can give, is no bound.
    expect(ids({ from: '10000-01-01' })).toStrictEqual(ids({}));
  });
});

describe('the pills and the sheet', () => {
  it('reads « Payé par moi » as the payers reduced to me, and presses it by setting them', () => {
    expect(paidByMe(NO_FILTER, me)).toBe(false);
    const pressed = togglePaidByMe(NO_FILTER, me);
    expect(pressed.payers).toStrictEqual([me]);
    expect(paidByMe(pressed, me)).toBe(true);
    expect(paidByMe({ ...NO_FILTER, payers: [me, m1] }, me)).toBe(false);
    expect(togglePaidByMe(pressed, me).payers).toStrictEqual([]);
    // Pressed over other payers, it replaces them.
    expect(togglePaidByMe({ ...NO_FILTER, payers: [m1] }, me).payers).toStrictEqual([me]);
  });

  it('tells a criterion of the sheet from the pills', () => {
    expect(isActive(NO_FILTER, me)).toBe(false);
    expect(hasAdvanced({ ...NO_FILTER, involvesMe: true, payers: [me] }, me)).toBe(false);
    expect(isActive({ ...NO_FILTER, involvesMe: true }, me)).toBe(true);
    expect(isActive({ ...NO_FILTER, payers: [me] }, me)).toBe(true);
    const advanced: Partial<ListFilter>[] = [
      { search: 'pizza' },
      { kind: 'expense' },
      { payers: [m1] },
      { payers: [me, m1] },
      { involved: [me] },
      { minAmount: '1' },
      { maxAmount: '0' },
      { from: '2026-01-01' },
      { to: '2026-01-01' },
    ];
    for (const criterion of advanced) {
      expect(hasAdvanced({ ...NO_FILTER, ...criterion }, me)).toBe(true);
      expect(isActive({ ...NO_FILTER, ...criterion }, me)).toBe(true);
    }
    // Blank or unreadable, a field sets nothing.
    expect(hasAdvanced({ ...NO_FILTER, search: ' ', minAmount: 'x', maxAmount: ' ', from: '10000-01-01', to: '2026-1-1' }, me)).toBe(false);
    // The mode alone, without members, sets nothing either.
    expect(hasAdvanced({ ...NO_FILTER, involvedMode: 'any' }, me)).toBe(false);
  });

  it('reads a bound typed in euros, to the cent, never through a float', () => {
    expect(amountBound('20')).toBe(2_000);
    expect(amountBound('0,1')).toBe(10);
    expect(amountBound('1 234,56 €')).toBe(123_456);
    expect(amountBound('19.99€')).toBe(1_999);
    expect(amountBound('')).toBeUndefined();
    expect(amountBound('-5')).toBeUndefined();
  });

  it('compares titles without accents nor case', () => {
    expect(normalized('  Œufs à la Crème Brûlée ')).toBe('œufs a la creme brulee');
  });
});

describe('resultHeading', () => {
  it('counts the expenses, their total and my share, to the cent, reimbursements left out', () => {
    expect(resultHeading(operations, me)).toStrictEqual({ kind: 'expense', count: 4, total: 4_500 + 1_200 + 250 + 2_000, myShare: 2_000 + 250 });
  });

  it('counts the reimbursements when no expense is left, and nothing when nothing is', () => {
    expect(resultHeading(filterOperations(operations, { ...NO_FILTER, kind: 'reimbursement' }, me), me)).toStrictEqual({
      kind: 'reimbursement',
      count: 1,
      total: 1_200,
    });
    expect(resultHeading([], me)).toStrictEqual({ kind: 'reimbursement', count: 0, total: 0 });
  });
});
