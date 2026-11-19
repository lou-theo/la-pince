import {
  type Balance,
  type Change,
  computeBalances,
  type Effect,
  type Entry,
  type Kind,
  type Member,
  type MemberId,
  type Operation,
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
  readonly entry: Entry;
  readonly effect: Effect;
  /** Its current revision waits in the outbox, not yet sent to the server. */
  readonly pending: boolean;
}

/** A revision with the seq of its operation's first revision, which orders operations as they were entered. */
export type Revision = Operation & { readonly createdSeq: number };

/** What the phone shows: the server's copy overlaid with the revisions of the outbox, the last one of each operation winning, as on the server. */
export interface Overlaid {
  readonly revisions: readonly Revision[];
  /** Operations whose shown revision waits in the outbox. */
  readonly pending: ReadonlySet<OperationId>;
}

/**
 * The server's copy overlaid with the outbox, in the order of entry. An operation entered on this phone and not yet on the server comes after every
 * operation of the server, in the order of entry, until the server gives it its own `createdSeq`.
 */
export function overlay(changes: ReadonlyMap<OperationId, Change>, outbox: readonly Operation[]): Overlaid {
  const revisions = new Map<OperationId, Revision>(changes);
  const pending = new Set<OperationId>();
  outbox.forEach((operation, index) => {
    const createdSeq = revisions.get(operation.id)?.createdSeq ?? Number.MAX_SAFE_INTEGER - outbox.length + index;
    revisions.set(operation.id, { ...operation, createdSeq });
    pending.add(operation.id);
  });
  return { revisions: [...revisions.values()], pending };
}

/** Operations of the group that are not deleted, the latest day first and, within a day, the latest entered first. */
export function liveOperations(revisions: Iterable<Revision>, pending: ReadonlySet<OperationId> = new Set()): OperationView[] {
  const operations: OperationView[] = [];
  for (const revision of revisions) {
    const effect = operationEffect(revision);
    if ('entry' in revision && effect !== undefined) {
      const { id, title, date, author, createdSeq } = revision;
      operations.push({ id, title, date, kind: revision.entry.kind, author, createdSeq, entry: revision.entry, effect, pending: pending.has(id) });
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
