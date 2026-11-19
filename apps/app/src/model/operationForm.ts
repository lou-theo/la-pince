import {
  computeEffect,
  type Effect,
  enteredAmountSchema,
  type Entry,
  entrySchema,
  type Kind,
  type MemberId,
  type Operation,
  type OperationId,
  operationSchema,
  operationTitleSchema,
  type RevisionId,
} from '@la-pince/core';

import type { OperationView } from './group.ts';
import { centsToInput } from './money.ts';

/** How an expense is split: the same share for each member checked, or an amount typed for each member. */
export type SplitMode = 'equal' | 'amounts';

/** What the form of an expense or a reimbursement holds, as typed: amounts stay strings until the form is read. */
export interface FormState {
  /** Fixed when the form opens: the leftover cent of an equal split depends on it, so the preview shows what will be saved. */
  readonly id: OperationId;
  readonly kind: Kind;
  readonly title: string;
  readonly date: string;
  /** Total of an equal split or of a reimbursement; with amounts, an optional control total. */
  readonly amount: string;
  readonly payer: MemberId;
  readonly mode: SplitMode;
  /** Members of an equal split; for a reimbursement, the single member who receives it. */
  readonly checked: readonly MemberId[];
  readonly amounts: Readonly<Record<MemberId, string>>;
}

export type FormAction =
  | { readonly type: 'title' | 'date' | 'amount'; readonly value: string }
  | { readonly type: 'payer' | 'toggle' | 'receiver'; readonly member: MemberId }
  | { readonly type: 'mode'; readonly mode: SplitMode }
  | { readonly type: 'checkAll'; readonly members: readonly MemberId[] }
  | { readonly type: 'uncheckAll' }
  | { readonly type: 'memberAmount'; readonly member: MemberId; readonly value: string };

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'title':
    case 'date':
    case 'amount':
      return { ...state, [action.type]: action.value };
    case 'payer':
      return { ...state, payer: action.member };
    case 'toggle':
      return {
        ...state,
        checked: state.checked.includes(action.member)
          ? state.checked.filter((member) => member !== action.member)
          : [...state.checked, action.member],
      };
    case 'receiver':
      return { ...state, checked: [action.member] };
    case 'mode':
      return { ...state, mode: action.mode };
    case 'checkAll':
      return { ...state, checked: [...action.members] };
    case 'uncheckAll':
      return { ...state, checked: [] };
    case 'memberAmount':
      return { ...state, amounts: { ...state.amounts, [action.member]: action.value } };
  }
}

/** A new expense: paid by who I am, split equally between all members. */
export function newExpense({ id, me, members, today }: { id: OperationId; me: MemberId; members: readonly MemberId[]; today: string }): FormState {
  return { id, kind: 'expense', title: '', date: today, amount: '', payer: me, mode: 'equal', checked: [...members], amounts: {} };
}

/** A new reimbursement, prefilled from a suggested transfer when there is one. */
export function newReimbursement({
  id,
  title,
  today,
  from,
  to,
  amount,
}: {
  id: OperationId;
  title: string;
  today: string;
  from: MemberId;
  to: MemberId | undefined;
  amount: number | undefined;
}): FormState {
  return {
    id,
    kind: 'reimbursement',
    title,
    date: today,
    amount: amount === undefined ? '' : centsToInput(amount),
    payer: from,
    mode: 'amounts',
    checked: to === undefined ? [] : [to],
    amounts: {},
  };
}

/**
 * The form of an operation to modify. An entry of equal weights opens as an equal split; any other (amounts, unequal weights, a mix) opens as
 * amounts, each member's amount being their share in the current effect, so that saving it unchanged keeps every share.
 */
export function editForm(operation: OperationView): FormState {
  const { entry, effect } = operation;
  const base = {
    id: operation.id,
    kind: entry.kind,
    title: operation.title,
    date: operation.date,
    payer: entry.payer,
    amount: centsToInput(effect.total),
  };
  const weights = new Set(entry.lines.map((line) => ('weight' in line ? line.weight : undefined)));
  if (entry.kind === 'expense' && weights.size === 1 && !weights.has(undefined)) {
    return { ...base, mode: 'equal', checked: entry.lines.map((line) => line.member), amounts: {} };
  }
  if (entry.kind === 'reimbursement') {
    return { ...base, mode: 'amounts', checked: effect.shares.map((share) => share.member), amounts: {} };
  }
  return {
    ...base,
    mode: 'amounts',
    checked: [],
    amounts: Object.fromEntries(effect.shares.map((share) => [share.member, centsToInput(share.amount)])),
  };
}

export type AmountError = 'required' | 'invalid' | 'zero' | 'mismatch';
export type SplitError = 'none_checked' | 'no_amount' | 'same_member' | 'too_large';

/** What is wrong with the form, field by field; `amounts` lists the members whose typed amount cannot be read. */
export interface FormErrors {
  readonly title?: 'required' | 'too_long';
  readonly date?: 'invalid';
  readonly amount?: AmountError;
  readonly split?: SplitError;
  readonly amounts?: readonly MemberId[];
}

type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: FormErrors };

/** Cents of a typed amount, none when it is empty or cannot be read. */
export function typedCents(typed: string): number | undefined {
  const parsed = enteredAmountSchema.safeParse(typed);
  return parsed.success ? parsed.data : undefined;
}

/** Sum of the amounts typed for each member that can be read, shown under an amounts split. */
export function typedSum(state: FormState): number {
  return Object.values(state.amounts).reduce((sum, typed) => sum + (typedCents(typed) ?? 0), 0);
}

/** The entry the form describes, or what keeps it from being one. */
export function readEntry(state: FormState): Read<Entry> {
  const errors: { amount?: AmountError; split?: SplitError; amounts?: MemberId[] } = {};
  const typedTotal = state.amount.trim();
  const total = typedCents(typedTotal);
  if (state.mode === 'equal' || state.kind === 'reimbursement') {
    if (typedTotal === '') {
      errors.amount = 'required';
    } else if (total === undefined) {
      errors.amount = 'invalid';
    } else if (total === 0) {
      errors.amount = 'zero';
    }
  }
  let lines: readonly object[] = [];
  if (state.kind === 'reimbursement') {
    const receiver = state.checked[0];
    if (receiver === undefined) {
      errors.split = 'none_checked';
    } else if (receiver === state.payer) {
      errors.split = 'same_member';
    } else {
      // Without a readable total the amount error stops the entry below.
      lines = [{ member: receiver, amount: total }];
    }
  } else if (state.mode === 'equal') {
    if (state.checked.length === 0) {
      errors.split = 'none_checked';
    }
    lines = state.checked.map((member) => ({ member, weight: 1 }));
  } else {
    const fixed: { member: MemberId; amount: number }[] = [];
    const unreadable: MemberId[] = [];
    for (const [member, typed] of Object.entries(state.amounts) as [MemberId, string][]) {
      const amount = typedCents(typed);
      if (typed.trim() === '' || amount === 0) {
        continue;
      }
      if (amount === undefined) {
        unreadable.push(member);
      } else {
        fixed.push({ member, amount });
      }
    }
    if (unreadable.length > 0) {
      errors.amounts = unreadable;
    } else if (fixed.length === 0) {
      errors.split = 'no_amount';
    }
    if (typedTotal !== '') {
      if (total === undefined) {
        errors.amount = 'invalid';
      } else if (unreadable.length === 0 && total !== fixed.reduce((sum, line) => sum + line.amount, 0)) {
        errors.amount = 'mismatch';
      }
    }
    lines = fixed;
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  const withTotal = state.kind === 'expense' && state.mode === 'equal' ? { total } : {};
  const entry = entrySchema.safeParse({ version: 1, kind: state.kind, payer: state.payer, ...withTotal, lines });
  // What the fields allow and the schema refuses: a sum of amounts above the largest total.
  return entry.success ? { ok: true, value: entry.data } : { ok: false, errors: { split: 'too_large' } };
}

/** Effect of the form as it stands, to preview each share before saving; none while the form is not an entry. */
export function previewEffect(state: FormState): Effect | undefined {
  const entry = readEntry(state);
  return entry.ok ? computeEffect(state.id, entry.value) : undefined;
}

/** The revision to send: a new `revisionId` for each send, the author being who I am. */
export function readForm(state: FormState, { revisionId, author }: { revisionId: RevisionId; author: MemberId }): Read<Operation> {
  const entry = readEntry(state);
  const title = operationTitleSchema.safeParse(state.title.trim());
  const operation = operationSchema.safeParse({
    id: state.id,
    revisionId,
    title: title.data,
    date: state.date,
    author,
    entry: entry.ok ? entry.value : undefined,
  });
  if (entry.ok && operation.success) {
    return { ok: true, value: operation.data };
  }
  // The day comes from a date field: empty, or refused by the schema (a day that does not exist).
  const dateValid = operationSchema.safeParse({ id: state.id, revisionId, title: 'x', date: state.date, deleted: true }).success;
  const errors: FormErrors = {
    ...(entry.ok ? {} : entry.errors),
    ...(title.success ? {} : { title: state.title.trim() === '' ? 'required' : 'too_long' }),
    ...(dateValid ? {} : { date: 'invalid' }),
  };
  return { ok: false, errors };
}

/** The revision that deletes an operation, keeping its title and day so that the deletion reads like any change. */
export function deletionOf(
  operation: Pick<OperationView, 'id' | 'title' | 'date'>,
  { revisionId, author }: { revisionId: RevisionId; author: MemberId },
): Operation {
  return operationSchema.parse({ id: operation.id, revisionId, title: operation.title, date: operation.date, author, deleted: true });
}
