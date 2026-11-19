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
  newExpense,
  newReimbursement,
  previewEffect,
  readEntry,
  readForm,
  typedSum,
} from './operationForm.ts';

const alice = memberIdSchema.parse('m1');
const bruno = memberIdSchema.parse('m2');
const chloe = memberIdSchema.parse('m3');
const id = operationIdSchema.parse('op-1');
const send = { revisionId: revisionIdSchema.parse('rev-1'), author: bruno };
const apply = (state: FormState, ...actions: FormAction[]) => actions.reduce(formReducer, state);
const expense = () => newExpense({ id, me: bruno, members: [alice, bruno, chloe], today: '2026-11-05' });
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
  it('is paid by who I am, on the day, split equally between everyone', () => {
    expect(expense()).toStrictEqual({
      id,
      kind: 'expense',
      title: '',
      date: '2026-11-05',
      amount: '',
      payer: bruno,
      mode: 'equal',
      checked: [alice, bruno, chloe],
      amounts: {},
    });
  });

  it('becomes the revision to send, equal weights on the total, author who I am', () => {
    const state = apply(expense(), { type: 'title', value: '  Courses ' }, { type: 'amount', value: '10' }, { type: 'payer', member: alice });
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
    const state = apply(expense(), { type: 'title', value: 'Courses' }, { type: 'amount', value: '10' });
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
  });
});

describe('an expense split by amounts', () => {
  const byAmounts = () => apply(expense(), { type: 'title', value: 'Restaurant' }, { type: 'mode', mode: 'amounts' });

  it('keeps the members with an amount, the total being their sum', () => {
    const state = apply(
      byAmounts(),
      { type: 'memberAmount', member: alice, value: '12,50' },
      { type: 'memberAmount', member: chloe, value: '7' },
      { type: 'memberAmount', member: bruno, value: '0' },
    );
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

  it('checks the sum against a control total when one is typed', () => {
    const state = apply(byAmounts(), { type: 'memberAmount', member: alice, value: '12,50' }, { type: 'memberAmount', member: chloe, value: '7' });
    expect(readEntry(apply(state, { type: 'amount', value: '19,50' })).ok).toBe(true);
    expect(readEntry(apply(state, { type: 'amount', value: '19,49' }))).toStrictEqual({ ok: false, errors: { amount: 'mismatch' } });
    expect(readEntry(apply(state, { type: 'amount', value: 'abc' }))).toStrictEqual({ ok: false, errors: { amount: 'invalid' } });
  });

  it('names the members whose amount cannot be read, and refuses a split without any amount', () => {
    const state = apply(
      byAmounts(),
      { type: 'memberAmount', member: alice, value: '1,234' },
      { type: 'memberAmount', member: chloe, value: '3' },
      { type: 'amount', value: '3' },
    );
    expect(typedSum(state)).toBe(300);
    expect(readEntry(state)).toStrictEqual({ ok: false, errors: { amounts: [alice] } });
    expect(readEntry(byAmounts())).toStrictEqual({ ok: false, errors: { split: 'no_amount' } });
  });

  it('refuses a sum above the largest total', () => {
    const state = apply(
      byAmounts(),
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
    expect(state).toMatchObject({ mode: 'amounts', amount: '10,00', amounts: { m1: '1,00', m2: '3,00', m3: '6,00' } });
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
