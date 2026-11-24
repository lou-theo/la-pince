import { type Change, changeSchema, memberIdSchema, operationEffect, operationIdSchema, revisionIdSchema } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { change } from '../testing/fake-server.ts';
import { liveOperations } from './group.ts';
import {
  deletionOf,
  editForm,
  type FormAction,
  formReducer,
  type FormState,
  hasChanged,
  newExpense,
  newReimbursement,
  previewEffect,
  readEntry,
  readForm,
  splitStatus,
  typedSum,
} from './operationForm.ts';

const alice = memberIdSchema.parse('m1');
const bruno = memberIdSchema.parse('m2');
const chloe = memberIdSchema.parse('m3');
const id = operationIdSchema.parse('op-1');
const send = { revisionId: revisionIdSchema.parse('rev-1'), author: bruno };
const apply = (state: FormState, ...actions: FormAction[]) => actions.reduce(formReducer, state);
const expense = () => newExpense({ id, me: bruno, today: '2026-11-05' });
const everyone = { type: 'checkAll', members: [alice, bruno, chloe] } as const;
/** Effect of the revision the form would send, computed as the server and every phone will. */
const saved = (state: FormState) => {
  const read = readForm(state, send);
  return read.ok ? operationEffect(read.value) : undefined;
};
const view = (value: Change) => {
  const [operation] = liveOperations([value]);
  if (operation === undefined) {
    throw new Error('a deleted operation has no form');
  }
  return operation;
};

describe('a new expense', () => {
  it('is paid by who I am, on the day, for me alone', () => {
    expect(expense()).toStrictEqual({
      id,
      kind: 'expense',
      title: '',
      date: '2026-11-05',
      amount: '',
      payer: bruno,
      mode: 'equal',
      checked: [bruno],
      amounts: {},
    });
  });

  it('becomes the revision to send, equal weights on the total, author who I am', () => {
    const state = apply(
      expense(),
      everyone,
      { type: 'title', value: '  Courses ' },
      { type: 'amount', value: '10' },
      { type: 'payer', member: alice },
    );
    expect(readForm(state, send)).toStrictEqual({
      ok: true,
      value: {
        id,
        revisionId: 'rev-1',
        title: 'Courses',
        date: '2026-11-05',
        author: bruno,
        entry: { version: 1, kind: 'expense', payer: alice, total: 1_000, lines: [alice, bruno, chloe].map((member) => ({ member, weight: 1 })) },
      },
    });
  });

  it('previews each share as it will be saved, the leftover cent included', () => {
    const state = apply(expense(), everyone, { type: 'title', value: 'Courses' }, { type: 'amount', value: '10' });
    const preview = previewEffect(state);
    expect(preview?.shares.map((share) => share.amount).toSorted()).toStrictEqual([333, 333, 334]);
    // The member who gets the leftover cent in the preview is the one charged by what is saved, whatever the operation id.
    for (const other of ['op-2', 'op-3', 'op-4', 'op-5', 'op-6']) {
      const withId = { ...state, id: operationIdSchema.parse(other) };
      expect(previewEffect(withId)).toStrictEqual(saved(withId));
    }
    expect(preview).toStrictEqual(saved(state));
    expect(previewEffect(apply(state, { type: 'uncheckAll' }))).toBeUndefined();
  });

  it('checks and unchecks members one by one or all at once', () => {
    const state = apply(
      expense(),
      { type: 'uncheckAll' },
      { type: 'toggle', member: chloe },
      { type: 'toggle', member: alice },
      { type: 'toggle', member: chloe },
    );
    expect(state.checked).toStrictEqual([alice]);
    expect(apply(state, { type: 'checkAll', members: [chloe, alice, bruno] }).checked).toStrictEqual([chloe, alice, bruno]);
  });

  it('tells each field that keeps it from being saved', () => {
    expect(readForm(apply(expense(), { type: 'uncheckAll' }, { type: 'date', value: '' }), send)).toStrictEqual({
      ok: false,
      errors: { amount: 'required', split: 'none_checked', title: 'required', date: 'invalid' },
    });
    expect(
      readForm(
        apply(expense(), { type: 'title', value: 'x'.repeat(101) }, { type: 'amount', value: '12,345' }, { type: 'date', value: '2026-02-30' }),
        send,
      ),
    ).toStrictEqual({
      ok: false,
      errors: { amount: 'invalid', title: 'too_long', date: 'invalid' },
    });
    expect(readEntry(apply(expense(), { type: 'amount', value: '0,00' }))).toStrictEqual({ ok: false, errors: { amount: 'zero' } });
    expect(readForm(apply(expense(), { type: 'amount', value: '5' }), send)).toStrictEqual({ ok: false, errors: { title: 'required' } });
  });

  it('says each equal share, or the two shares a leftover cent makes', () => {
    expect(splitStatus(apply(expense(), everyone, { type: 'amount', value: '9' }))).toStrictEqual({ kind: 'each', low: 300, high: 300 });
    expect(splitStatus(apply(expense(), everyone, { type: 'amount', value: '10' }))).toStrictEqual({ kind: 'each', low: 333, high: 334 });
    expect(splitStatus(apply(expense(), { type: 'amount', value: 'abc' }))).toBeUndefined();
    // 0,02 € for three: one member's share is 0.
    expect(splitStatus(apply(expense(), everyone, { type: 'amount', value: '0,02' }))).toStrictEqual({ kind: 'each', low: 0, high: 1 });
  });
});

describe('an expense split by amounts', () => {
  const byAmounts = () =>
    apply(expense(), { type: 'title', value: 'Restaurant' }, { type: 'mode', mode: 'amounts' }, { type: 'toggle', member: bruno }, everyone);

  it('keeps a line for each member checked, the total being their sum', () => {
    const state = apply(
      byAmounts(),
      { type: 'memberAmount', member: alice, value: '12,50' },
      { type: 'memberAmount', member: chloe, value: '7' },
      { type: 'memberAmount', member: bruno, value: '3' },
      { type: 'toggle', member: bruno },
    );
    expect(state.amounts).toStrictEqual({ [alice]: '12,50', [chloe]: '7' });
    expect(typedSum(state)).toBe(1_950);
    expect(readEntry(state)).toStrictEqual({
      ok: true,
      value: {
        version: 1,
        kind: 'expense',
        payer: bruno,
        lines: [
          { member: alice, amount: 1_250 },
          { member: chloe, amount: 700 },
        ],
      },
    });
  });

  it('checks the sum against a control total when one is typed, saying what is left or over', () => {
    const state = apply(
      byAmounts(),
      { type: 'toggle', member: bruno },
      { type: 'memberAmount', member: alice, value: '12,50' },
      { type: 'memberAmount', member: chloe, value: '7' },
    );
    expect(splitStatus(byAmounts())).toBeUndefined();
    expect(splitStatus(apply(state, { type: 'uncheckAll' }))).toBeUndefined();
    expect(splitStatus(apply(state, { type: 'uncheckAll' }, { type: 'amount', value: '0' }))).toBeUndefined();
    expect(splitStatus(state)).toStrictEqual({ kind: 'matches' });
    // A line left empty is missing from the sum: the amounts do not make the total yet.
    const withEmpty = apply(state, { type: 'toggle', member: bruno });
    expect(splitStatus(withEmpty)).toBeUndefined();
    expect(splitStatus(apply(withEmpty, { type: 'amount', value: '19,50' }))).toBeUndefined();
    expect(splitStatus(apply(withEmpty, { type: 'amount', value: '20' }))).toStrictEqual({ kind: 'left', amount: 50 });
    expect(readEntry(apply(state, { type: 'amount', value: '19,50' })).ok).toBe(true);
    expect(splitStatus(apply(state, { type: 'amount', value: '19,50' }))).toStrictEqual({ kind: 'matches' });
    expect(readEntry(apply(state, { type: 'amount', value: '19,49' }))).toStrictEqual({ ok: false, errors: { amount: 'mismatch' } });
    expect(splitStatus(apply(state, { type: 'amount', value: '19,49' }))).toStrictEqual({ kind: 'over', amount: 1 });
    expect(splitStatus(apply(state, { type: 'amount', value: '26' }))).toStrictEqual({ kind: 'left', amount: 650 });
    expect(readEntry(apply(state, { type: 'amount', value: 'abc' }))).toStrictEqual({ ok: false, errors: { amount: 'invalid' } });
    expect(splitStatus(apply(state, { type: 'amount', value: 'abc' }))).toBeUndefined();
  });

  it('names each member whose line is empty, zero or unreadable, and refuses a split without anyone', () => {
    const state = apply(
      byAmounts(),
      { type: 'memberAmount', member: alice, value: '1,234' },
      { type: 'memberAmount', member: chloe, value: '3' },
      { type: 'memberAmount', member: bruno, value: '0,00' },
      { type: 'amount', value: '3' },
    );
    expect(typedSum(state)).toBe(300);
    expect(typedSum(byAmounts())).toBe(0);
    expect(readForm(byAmounts(), send)).toStrictEqual({
      ok: false,
      errors: { amounts: { [alice]: 'missing', [bruno]: 'missing', [chloe]: 'missing' } },
    });
    expect(readEntry(state)).toStrictEqual({ ok: false, errors: { amounts: { [alice]: 'invalid', [bruno]: 'missing' } } });
    expect(readEntry(apply(state, { type: 'memberAmount', member: bruno, value: ' ' }))).toMatchObject({
      errors: { amounts: { [bruno]: 'missing' } },
    });
    expect(readEntry(apply(state, { type: 'uncheckAll' }))).toStrictEqual({ ok: false, errors: { split: 'none_checked', amount: 'mismatch' } });
  });

  it('turns equal shares into amounts, each the share it was, and keeps the members checked', () => {
    const equal = apply(expense(), everyone, { type: 'amount', value: '10' });
    const amounts = apply(equal, { type: 'mode', mode: 'amounts' });
    expect(amounts).toMatchObject({ mode: 'amounts', checked: [alice, bruno, chloe], amount: '10' });
    expect(saved(amounts)?.shares).toStrictEqual(saved(equal)?.shares);
    expect(apply(amounts, { type: 'mode', mode: 'amounts' })).toBe(amounts);
    // Without a total to share, the lines are left as they were.
    expect(apply(expense(), { type: 'mode', mode: 'amounts' }).amounts).toStrictEqual({});
    expect(apply(amounts, { type: 'mode', mode: 'equal' })).toMatchObject({ mode: 'equal', checked: [alice, bruno, chloe] });
  });

  it('refuses a sum above the largest total', () => {
    const state = apply(
      byAmounts(),
      { type: 'toggle', member: bruno },
      { type: 'memberAmount', member: alice, value: '99999999' },
      { type: 'memberAmount', member: chloe, value: '99999999' },
    );
    expect(readEntry(state)).toStrictEqual({ ok: false, errors: { split: 'too_large' } });
  });
});

describe('a reimbursement', () => {
  const prefilled = () => newReimbursement({ id, title: 'Remboursement', today: '2026-11-05', from: bruno, to: alice, amount: 1_250 });

  it('opens prefilled from a suggested transfer', () => {
    expect(prefilled()).toMatchObject({ kind: 'reimbursement', title: 'Remboursement', amount: '12,50', payer: bruno, checked: [alice] });
    expect(newReimbursement({ id, title: 'Remboursement', today: '2026-11-05', from: bruno, to: undefined, amount: undefined })).toMatchObject({
      amount: '',
      checked: [],
    });
  });

  it('becomes one line for the member who receives it', () => {
    expect(readEntry(apply(prefilled(), { type: 'receiver', member: chloe }))).toStrictEqual({
      ok: true,
      value: { version: 1, kind: 'reimbursement', payer: bruno, lines: [{ member: chloe, amount: 1_250 }] },
    });
  });

  it('refuses one total for several receivers, which would move the money of all but one', () => {
    expect(readEntry(apply(prefilled(), { type: 'toggle', member: chloe }))).toStrictEqual({ ok: false, errors: { split: 'several_receivers' } });
  });

  it('needs someone to receive it other than who pays it', () => {
    expect(readEntry(apply(prefilled(), { type: 'receiver', member: bruno }))).toStrictEqual({ ok: false, errors: { split: 'same_member' } });
    expect(readEntry(newReimbursement({ id, title: 'R', today: '2026-11-05', from: bruno, to: undefined, amount: undefined }))).toStrictEqual({
      ok: false,
      errors: { amount: 'required', split: 'none_checked' },
    });
  });
});

describe('editForm', () => {
  const parse = (entry: object) =>
    changeSchema.parse({ id: 'op-9', revisionId: 'r', title: 'Courses', date: '2026-11-01', seq: 3, createdSeq: 1, entry: { version: 1, ...entry } });

  it('opens an entry of equal weights as an equal split, which saves back unchanged', () => {
    const current = parse({
      kind: 'expense',
      payer: 'm1',
      total: 1_000,
      lines: [
        { member: 'm1', weight: 2 },
        { member: 'm3', weight: 2 },
      ],
    });
    const state = editForm(view(current));
    expect(state).toMatchObject({
      id: 'op-9',
      title: 'Courses',
      date: '2026-11-01',
      amount: '10,00',
      payer: 'm1',
      mode: 'equal',
      checked: ['m1', 'm3'],
    });
    expect(readEntry(state)).toMatchObject({
      ok: true,
      value: {
        total: 1_000,
        lines: [
          { member: 'm1', weight: 1 },
          { member: 'm3', weight: 1 },
        ],
      },
    });
  });

  it('opens any other entry as amounts, each the share of its member, so that saving keeps every share', () => {
    const current = parse({
      kind: 'expense',
      payer: 'm1',
      total: 1_000,
      lines: [
        { member: 'm1', amount: 100 },
        { member: 'm2', weight: 1 },
        { member: 'm3', weight: 2 },
      ],
    });
    const { effect } = view(current);
    const state = editForm(view(current));
    expect(state).toMatchObject({ mode: 'amounts', amount: '10,00', checked: ['m1', 'm2', 'm3'], amounts: { m1: '1,00', m2: '3,00', m3: '6,00' } });
    expect(saved(state)?.shares).toStrictEqual(effect.shares);
  });

  it('keeps each share of unequal weights with a leftover cent, and of fixed amounts with their total, as imported', () => {
    for (const entry of [
      {
        kind: 'expense',
        payer: 'm2',
        total: 1_001,
        lines: [
          { member: 'm1', weight: 1 },
          { member: 'm2', weight: 1 },
          { member: 'm3', weight: 3 },
        ],
      },
      {
        kind: 'expense',
        payer: 'm2',
        total: 1_000,
        lines: [
          { member: 'm1', weight: 1 },
          { member: 'm3', weight: 2 },
        ],
      },
      {
        kind: 'expense',
        payer: 'm1',
        total: 4_500,
        lines: [
          { member: 'm1', amount: 1_000 },
          { member: 'm2', amount: 2_000 },
          { member: 'm3', amount: 1_500 },
        ],
      },
    ]) {
      const current = view(parse(entry));
      expect(saved(apply(editForm(current), { type: 'title', value: 'Renamed' }))?.shares).toStrictEqual(current.effect.shares);
    }
  });

  it('opens a reimbursement on the member who received it', () => {
    const current = change({ id: 'r', date: '2026-11-02', kind: 'reimbursement', payer: 'm2', lines: [['m1', 500]] });
    expect(editForm(view(current))).toMatchObject({ kind: 'reimbursement', amount: '5,00', payer: 'm2', checked: ['m1'] });
  });
});

describe('hasChanged', () => {
  it('tells a form that says something new from one only reordered, or changed where it does not count', () => {
    const initial = apply(expense(), everyone, { type: 'amount', value: '10' });
    expect(hasChanged(initial, initial)).toBe(false);
    expect(hasChanged(initial, apply(initial, { type: 'title', value: 'Courses' }))).toBe(true);
    expect(hasChanged(initial, apply(initial, { type: 'toggle', member: alice }))).toBe(true);
    // The same members checked in another order, and lines typed then left for equal shares, say the same thing.
    expect(hasChanged(initial, apply(initial, { type: 'toggle', member: alice }, { type: 'toggle', member: alice }))).toBe(false);
    expect(hasChanged(initial, apply(initial, { type: 'memberAmount', member: alice, value: '4' }))).toBe(false);
    const amounts = apply(initial, { type: 'mode', mode: 'amounts' });
    expect(hasChanged(amounts, apply(amounts, { type: 'memberAmount', member: alice, value: '4' }))).toBe(true);
    const empty = apply(expense(), { type: 'mode', mode: 'amounts' });
    expect(hasChanged(empty, apply(empty, { type: 'memberAmount', member: bruno, value: '' }))).toBe(false);
  });
});

describe('deletionOf', () => {
  it('marks the operation deleted, keeping its title and day', () => {
    const current = change({ id: 'op-3', date: '2026-11-02', title: 'Péage' });
    expect(deletionOf(current, send)).toStrictEqual({
      id: 'op-3',
      revisionId: 'rev-1',
      title: 'Péage',
      date: '2026-11-02',
      author: bruno,
      deleted: true,
    });
  });
});
