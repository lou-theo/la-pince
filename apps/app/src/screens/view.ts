import type { Member, MemberId, Operation, Share, SuggestedTransfer } from '@la-pince/core';

import { m } from '../i18n/paraglide/messages.js';
import type { BalanceLine, OperationView } from '../model/group.ts';
import type { QueueResult } from '../sync/groupStore.ts';

/** What the group's screens read: its live operations and balances, the server's copy overlaid with the outbox, seen as “who I am”. */
export interface GroupView {
  readonly operations: readonly OperationView[];
  readonly balances: readonly BalanceLine[];
  readonly transfers: readonly SuggestedTransfer[];
  readonly me: MemberId;
  readonly nameOf: (id: MemberId) => string;
  /** Members in the order they were added, which orders the lines of a split. */
  readonly members: readonly Member[];
  /** Queues a revision of an operation on the phone, shown at once, sent as soon as the server answers. */
  readonly enqueue: (operation: Operation) => Promise<QueueResult>;
  /** Operations whose revision waits in the outbox, counted in the balances. */
  readonly pendingCount: number;
  /** When the last complete read of the group ended, in milliseconds since the epoch. */
  readonly readAt: number;
}

/** Shares of an operation in the order members were added, a member missing from the group's list last. */
export function sharesInOrder(view: GroupView, operation: OperationView): Share[] {
  const position = (member: MemberId) => {
    const index = view.members.findIndex((candidate) => candidate.id === member);
    return index === -1 ? view.members.length : index;
  };
  return operation.effect.shares.toSorted((a, b) => position(a.member) - position(b.member));
}

/** Who paid an expense, or who reimbursed whom. */
export function who(view: GroupView, operation: OperationView): string {
  const { payer } = operation.effect;
  if (operation.kind === 'reimbursement') {
    // A reimbursement's lines are the members who received it, a single one from Tricount.
    const to = sharesInOrder(view, operation).map((share) => view.nameOf(share.member));
    return m.operation_reimbursed({ from: view.nameOf(payer), to: to.join(', ') });
  }
  return m.operation_paid_by({ name: view.nameOf(payer) });
}
