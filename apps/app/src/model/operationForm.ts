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
  /** Members of the split, whatever its mode; for a reimbursement, the single member who receives it. */
  readonly checked: readonly MemberId[];
  /** Amount typed for each member of a split by amounts; only those of the members checked count. */
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
    case 'toggle': {
      if (!state.checked.includes(action.member)) {
        return { ...state, checked: [...state.checked, action.member] };
      }
      // A member taken out of a split by amounts comes back with an empty line.
      return {
        ...state,
        checked: state.checked.filter((member) => member !== action.member),
        amounts: Object.fromEntries(Object.entries(state.amounts).filter(([member]) => member !== action.member)),
      };
    }
    case 'receiver':
      return { ...state, checked: [action.member] };
    case 'mode':
      return action.mode === state.mode
        ? state
        : { ...state, mode: action.mode, amounts: action.mode === 'amounts' ? equalAmounts(state) : state.amounts };
    case 'checkAll':
      return { ...state, checked: [...action.members] };
    case 'uncheckAll':
      return { ...state, checked: [], amounts: {} };
    case 'memberAmount':
      return { ...state, amounts: { ...state.amounts, [action.member]: action.value } };
  }
}

/** Amounts of a split turning from equal to amounts: each member checked gets their equal share, when the total can be shared. */
function equalAmounts(state: FormState): Readonly<Record<MemberId, string>> {
  const preview = previewEffect(state);
  return preview === undefined ? state.amounts : Object.fromEntries(preview.shares.map((share) => [share.member, centsToInput(share.amount)]));
}

/** A new expense: paid by who I am, for me alone at first, an expense concerning 3 members in the median and never the whole group. */
export function newExpense({ id, me, today }: { id: OperationId; me: MemberId; today: string }): FormState {
  return { id, kind: 'expense', title: '', date: today, amount: '', payer: me, mode: 'equal', checked: [me], amounts: {} };
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
    checked: effect.shares.map((share) => share.member),
    amounts: Object.fromEntries(effect.shares.map((share) => [share.member, centsToInput(share.amount)])),
  };
}

/** Whether the form says something else than when it opened, what a person would lose by leaving it; amounts count only in a split by amounts. */
export function hasChanged(initial: FormState, state: FormState): boolean {
  const meaning = (form: FormState) => {
    const checked = form.checked.toSorted();
    const amounts = form.mode === 'amounts' ? checked.map((member) => form.amounts[member] ?? '') : [];
    return JSON.stringify([form.title, form.date, form.amount, form.payer, form.mode, checked, amounts]);
  };
  return meaning(initial) !== meaning(state);
}

export type AmountError = 'required' | 'invalid' | 'zero' | 'mismatch';
export type SplitError = 'none_checked' | 'same_member' | 'too_large' | 'several_receivers';

/** What keeps the line of one member of a split by amounts from being read: empty or zero, or unreadable. */
export type MemberAmountError = 'missing' | 'invalid';

/** What is wrong with the form, field by field; `amounts` gives the members whose line cannot be read, and why. */
export interface FormErrors {
  readonly title?: 'required' | 'too_long';
  readonly date?: 'invalid';
  readonly amount?: AmountError;
  readonly split?: SplitError;
  readonly amounts?: Readonly<Partial<Record<MemberId, MemberAmountError>>>;
}

type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: FormErrors };

/** Cents of a typed amount, none when it is empty or cannot be read. */
export function typedCents(typed: string): number | undefined {
  const parsed = enteredAmountSchema.safeParse(typed);
  return parsed.success ? parsed.data : undefined;
}

/** Sum of the amounts typed for the members checked that can be read. */
export function typedSum(state: FormState): number {
  return state.checked.reduce((sum, member) => sum + (typedCents(state.amounts[member] ?? '') ?? 0), 0);
}

/**
 * What the split says next to “For whom”: with equal shares, each one, `low` and `high` differing by the leftover cent; with amounts, what is
 * left to share or what goes over a typed total, or that the amounts make the total. None while the shares or the total cannot be read.
 */
export type SplitStatus =
  | { readonly kind: 'each'; readonly low: number; readonly high: number }
  | { readonly kind: 'left' | 'over'; readonly amount: number }
  | { readonly kind: 'matches' };

export function splitStatus(state: FormState): SplitStatus | undefined {
  if (state.mode === 'equal') {
    const amounts = previewEffect(state)?.shares.map((share) => share.amount);
    return amounts === undefined ? undefined : { kind: 'each', low: Math.min(...amounts), high: Math.max(...amounts) };
  }
  if (state.amount.trim() === '') {
    return { kind: 'matches' };
  }
  const total = typedCents(state.amount);
  if (total === undefined) {
    return undefined;
  }
  const sum = typedSum(state);
  if (total === sum) {
    return { kind: 'matches' };
  }
  return total > sum ? { kind: 'left', amount: total - sum } : { kind: 'over', amount: sum - total };
}

/** The entry the form describes, or what keeps it from being one. */
export function readEntry(state: FormState): Read<Entry> {
  const errors: { amount?: AmountError; split?: SplitError; amounts?: Partial<Record<MemberId, MemberAmountError>> } = {};
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
    const [receiver, ...others] = state.checked;
    if (others.length > 0) {
      // A reimbursement to several members, from another client: one total cannot say what each received.
      errors.split = 'several_receivers';
    } else if (receiver === undefined) {
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
    // Each member checked has a line to fill: an empty one is an error, not a member silently left out.
    const fixed: { member: MemberId; amount: number }[] = [];
    const unreadable: Partial<Record<MemberId, MemberAmountError>> = {};
    for (const member of state.checked) {
      const typed = state.amounts[member] ?? '';
      const amount = typedCents(typed);
      if (typed.trim() === '' || amount === 0) {
        unreadable[member] = 'missing';
      } else if (amount === undefined) {
        unreadable[member] = 'invalid';
      } else {
        fixed.push({ member, amount });
      }
    }
    const allRead = Object.keys(unreadable).length === 0;
    if (!allRead) {
      errors.amounts = unreadable;
    } else if (fixed.length === 0) {
      errors.split = 'none_checked';
    }
    if (typedTotal !== '') {
      if (total === undefined) {
        errors.amount = 'invalid';
      } else if (allRead && total !== fixed.reduce((sum, line) => sum + line.amount, 0)) {
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
