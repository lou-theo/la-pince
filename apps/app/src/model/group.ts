import {
  type Balance,
  type Change,
  computeBalances,
  type Effect,
  type Kind,
  type Member,
  type MemberId,
  operationEffect,
  type OperationId,
  type SuggestedTransfer,
  suggestTransfers,
} from '@la-pince/core';

/** An operation as the screens show it: its current revision and the effect computed from its entry, as on every phone. */
export interface OperationView {
  readonly id: OperationId;
  readonly title: string;
  readonly date: string;
  readonly kind: Kind;
  readonly author: MemberId | undefined;
  readonly createdSeq: number;
  readonly effect: Effect;
}

/** Operations of the group that are not deleted, the latest day first and, within a day, the latest entered first. */
export function liveOperations(changes: Iterable<Change>): OperationView[] {
  const operations: OperationView[] = [];
  for (const change of changes) {
    const effect = operationEffect(change);
    if ('entry' in change && effect !== undefined) {
      const { id, title, date, author, createdSeq } = change;
      operations.push({ id, title, date, kind: change.entry.kind, author, createdSeq, effect });
    }
  }
  // ISO days compare as strings.
  return operations.sort((a, b) => (a.date === b.date ? b.createdSeq - a.createdSeq : a.date < b.date ? 1 : -1));
}

/** “My share”: what the operation puts on that member, 0 when they are not involved. */
export function myShare(effect: Effect, member: MemberId): number {
  return effect.shares.find((share) => share.member === member)?.amount ?? 0;
}

export interface BalanceLine {
  readonly member: Member;
  readonly balance: Balance;
}

/**
 * Balance of every member, the largest first (the group owes them the most), ties in the order members were added; a member named by an operation
 * but missing from the group's list keeps their balance under their identifier, so that the balances still sum to zero.
 */
export function sortedBalances(members: readonly Member[], operations: readonly OperationView[]): BalanceLine[] {
  const balances = computeBalances(operations.map((operation) => operation.effect));
  const known = new Set(members.map((member) => member.id));
  const everyone = [...members, ...[...balances.keys()].filter((id) => !known.has(id)).map((id) => ({ id, name: id }))];
  return everyone
    .map((member, position) => ({ member, balance: balances.get(member.id) ?? 0, position }))
    .sort((a, b) => (a.balance === b.balance ? a.position - b.position : b.balance - a.balance))
    .map(({ member, balance }) => ({ member, balance }));
}

/** Transfers that bring the balances back to zero (core's stable greedy algorithm). */
export function transfers(balances: readonly BalanceLine[]): SuggestedTransfer[] {
  return suggestTransfers(new Map(balances.map((line) => [line.member.id, line.balance])));
}
