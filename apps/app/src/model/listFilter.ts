import type { Kind, MemberId } from '@la-pince/core';

import { myShare, type OperationView } from './group.ts';
import { typedCents } from './operationForm.ts';

/**
 * Filters of the list of operations, as the screens hold them: the two pills (“Me concerne”, “Payé par moi”, the latter being the payers reduced to
 * me) and the criteria of the sheet, amounts and days as typed, so that a field half typed keeps what the person wrote.
 */
export interface ListFilter {
  /** “Me concerne”: I have a share. */
  readonly involvesMe: boolean;
  /** Part of the title, any case and accents. */
  readonly search: string;
  readonly kind: 'all' | Kind;
  /** Who paid, any of them: an operation has a single payer. */
  readonly payers: readonly MemberId[];
  /** Members who have a share, all of them or at least one according to `involvedMode`. */
  readonly involved: readonly MemberId[];
  readonly involvedMode: 'all' | 'any';
  /** Bounds on the operation's total, included, as typed in euros. */
  readonly minAmount: string;
  readonly maxAmount: string;
  /** Bounds on the day, included, `YYYY-MM-DD` or empty. */
  readonly from: string;
  readonly to: string;
}

export const NO_FILTER: ListFilter = {
  involvesMe: false,
  search: '',
  kind: 'all',
  payers: [],
  involved: [],
  involvedMode: 'all',
  minAmount: '',
  maxAmount: '',
  from: '',
  to: '',
};

/** “Payé par moi”: the payers are me alone. */
export function paidByMe(filter: ListFilter, me: MemberId): boolean {
  return filter.payers.length === 1 && filter.payers[0] === me;
}

/** Presses or releases “Payé par moi”, which sets the payers to me alone or clears them. */
export function togglePaidByMe(filter: ListFilter, me: MemberId): ListFilter {
  return { ...filter, payers: paidByMe(filter, me) ? [] : [me] };
}

/** Cents of a bound typed in euros, a euro sign allowed; none when the field is empty or cannot be read. */
export function amountBound(typed: string): number | undefined {
  return typedCents(typed.replace('€', '').trim());
}

/** Whether a criterion of the sheet is set, beyond the two pills: the list then shows the summary instead of the pills. */
export function hasAdvanced(filter: ListFilter, me: MemberId): boolean {
  return (
    normalized(filter.search) !== '' ||
    filter.kind !== 'all' ||
    (filter.payers.length > 0 && !paidByMe(filter, me)) ||
    filter.involved.length > 0 ||
    amountBound(filter.minAmount) !== undefined ||
    amountBound(filter.maxAmount) !== undefined ||
    filter.from !== '' ||
    filter.to !== ''
  );
}

/** Whether any filter narrows the list. */
export function isActive(filter: ListFilter, me: MemberId): boolean {
  return filter.involvesMe || filter.payers.length > 0 || hasAdvanced(filter, me);
}

/** A title as the search compares it: without accents, in lower case, trimmed. */
export function normalized(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-FR').trim();
}

/** Operations, already in the order of the list, that every set criterion keeps. */
export function filterOperations(operations: readonly OperationView[], filter: ListFilter, me: MemberId): OperationView[] {
  const search = normalized(filter.search);
  const min = amountBound(filter.minAmount);
  const max = amountBound(filter.maxAmount);
  const involves = (operation: OperationView, member: MemberId) => myShare(operation.effect, member) > 0;
  // Both pills pressed keep whatever involves me, an expense I advanced without a share of mine included.
  const either = filter.involvesMe && paidByMe(filter, me);
  return operations.filter((operation) => {
    const { payer, total } = operation.effect;
    const paidBy = filter.payers.includes(payer);
    if (either) {
      if (!involves(operation, me) && !paidBy) {
        return false;
      }
    } else if ((filter.involvesMe && !involves(operation, me)) || (filter.payers.length > 0 && !paidBy)) {
      return false;
    }
    if (filter.involved.length > 0) {
      const has = (member: MemberId) => involves(operation, member);
      if (filter.involvedMode === 'all' ? !filter.involved.every(has) : !filter.involved.some(has)) {
        return false;
      }
    }
    return (
      (filter.kind === 'all' || operation.kind === filter.kind) &&
      (search === '' || normalized(operation.title).includes(search)) &&
      (min === undefined || total >= min) &&
      (max === undefined || total <= max) &&
      // ISO days compare as strings.
      (filter.from === '' || operation.date >= filter.from) &&
      (filter.to === '' || operation.date <= filter.to)
    );
  });
}

/** What the heading of a filtered list says: the expenses, their total and my share of them, or the reimbursements when there is no expense. */
export type ResultHeading =
  | { readonly kind: 'expense'; readonly count: number; readonly total: number; readonly myShare: number }
  | { readonly kind: 'reimbursement'; readonly count: number; readonly total: number };

export function resultHeading(operations: readonly OperationView[], me: MemberId): ResultHeading {
  const expenses = operations.filter((operation) => operation.kind === 'expense');
  if (expenses.length === 0) {
    return { kind: 'reimbursement', count: operations.length, total: sum(operations.map((operation) => operation.effect.total)) };
  }
  return {
    kind: 'expense',
    count: expenses.length,
    total: sum(expenses.map((operation) => operation.effect.total)),
    myShare: sum(expenses.map((operation) => myShare(operation.effect, me))),
  };
}

const sum = (amounts: readonly number[]) => amounts.reduce((total, amount) => total + amount, 0);
