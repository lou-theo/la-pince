import type { Member, MemberId, SuggestedTransfer } from '@la-pince/core';

import type { BalanceLine } from './group.ts';

/** Where a member stands: the group owes them (`ahead`), they owe the group (`owes`), or neither. */
export type Standing = 'ahead' | 'owes' | 'settled';

export function standing(balance: number): Standing {
  return balance > 0 ? 'ahead' : balance < 0 ? 'owes' : 'settled';
}

/** What a member owes, as the screen of the transfers groups it: their transfers and their sum. */
export interface DebtorTransfers {
  readonly debtor: MemberId;
  readonly total: number;
  readonly transfers: readonly SuggestedTransfer[];
}

// Order of addition to the group, which breaks ties; a member missing from the group's list comes after the others.
function addedOrder(members: readonly Member[]): (id: MemberId) => number {
  const positions = new Map(members.map((member, index) => [member.id, index]));
  return (id) => positions.get(id) ?? members.length;
}

// The largest amount first, ties in the order of addition of `side`; `toSorted` is stable, so the core's order breaks the remaining ties.
function byAmount(transfers: readonly SuggestedTransfer[], position: (id: MemberId) => number, side: 'from' | 'to'): SuggestedTransfer[] {
  return transfers.toSorted((a, b) => (a.amount === b.amount ? position(a[side]) - position(b[side]) : b.amount - a.amount));
}

/** The suggested transfers grouped by who pays them: the largest debt first, and within a debt, the largest transfer first; ties in the order of addition. */
export function transfersByDebtor(transfers: readonly SuggestedTransfer[], members: readonly Member[]): DebtorTransfers[] {
  const position = addedOrder(members);
  const byDebtor = new Map<MemberId, SuggestedTransfer[]>();
  for (const transfer of transfers) {
    byDebtor.set(transfer.from, [...(byDebtor.get(transfer.from) ?? []), transfer]);
  }
  return [...byDebtor]
    .map(([debtor, owed]) => ({ debtor, total: owed.reduce((sum, transfer) => sum + transfer.amount, 0), transfers: byAmount(owed, position, 'to') }))
    .sort((a, b) => (a.total === b.total ? position(a.debtor) - position(b.debtor) : b.total - a.total));
}

/** A member's sheet: their balance, the transfers they should make, and those they should receive, the largest first. */
export interface MemberSheet {
  readonly balance: number;
  readonly standing: Standing;
  readonly pays: readonly SuggestedTransfer[];
  readonly receives: readonly SuggestedTransfer[];
}

/** The sheet of a member, `undefined` for one the balances do not know (a link to a member who is not in the group). */
export function memberSheet(
  member: MemberId,
  balances: readonly BalanceLine[],
  transfers: readonly SuggestedTransfer[],
  members: readonly Member[],
): MemberSheet | undefined {
  const line = balances.find((candidate) => candidate.member.id === member);
  if (line === undefined) {
    return undefined;
  }
  const position = addedOrder(members);
  return {
    balance: line.balance,
    standing: standing(line.balance),
    pays: byAmount(
      transfers.filter((transfer) => transfer.from === member),
      position,
      'to',
    ),
    receives: byAmount(
      transfers.filter((transfer) => transfer.to === member),
      position,
      'from',
    ),
  };
}

/** Below this balance, in cents, the bag and the ball do not grow to their full size: a group of small balances keeps small ones. */
export const DECOR_SCALE_FLOOR = 5_000;
/** Size of the bag and of the ball, in pixels: readable at the smallest, still beside the avatar at the largest. */
export const DECOR_MIN_SIZE = 12;
export const DECOR_MAX_SIZE = 24;

/** The balance that gives the largest bag or ball: the largest balance in absolute value, at least `DECOR_SCALE_FLOOR`. One scale for both. */
export function decorScale(balances: readonly BalanceLine[]): number {
  return Math.max(DECOR_SCALE_FLOOR, ...balances.map((line) => Math.abs(line.balance)));
}

/** Size of the bag or the ball of a balance, in whole pixels, growing with the balance from `DECOR_MIN_SIZE` to `DECOR_MAX_SIZE`. */
export function decorSize(balance: number, scale: number): number {
  const share = Math.min(Math.abs(balance), scale) / scale;
  return DECOR_MIN_SIZE + Math.round(share * (DECOR_MAX_SIZE - DECOR_MIN_SIZE));
}
