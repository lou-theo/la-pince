import type { Member, MemberId, NewMember, Operation, Share, SuggestedTransfer } from '@la-pince/core';

import { formatMoment } from '../i18n/moment.ts';
import { m } from '../i18n/paraglide/messages.js';
import type { BalanceLine, OperationView } from '../model/group.ts';
import type { GroupEditError } from '../sync/client.ts';
import type { QueueResult } from '../sync/groupStore.ts';

export type EditResult = { readonly ok: true } | { readonly ok: false; readonly error: GroupEditError };

/** Edits of the group, sent at once to the server, whose answer the screens show: they need the network (docs/decisions/edition-du-groupe.md, point h). */
export interface GroupEdit {
  /** Whether the server can be reached: no read failed for want of network, and the browser does not say it is offline. */
  readonly online: boolean;
  readonly renameGroup: (title: string) => Promise<EditResult>;
  /** Adds a member whose id was drawn when the sheet to add one opened, sent again with each try. */
  readonly addMember: (member: NewMember) => Promise<EditResult>;
  readonly renameMember: (id: MemberId, name: string) => Promise<EditResult>;
}

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
  /** Title of the group, in the bar of the screens that take the whole screen. */
  readonly title: string;
  readonly edit: GroupEdit;
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

/** A member of the group, or one an operation names who is missing from its list, under their identifier as the balances keep them. */
export function memberOf(view: GroupView, id: MemberId): Member {
  return view.members.find((member) => member.id === id) ?? { id, name: id };
}

/** A member of the group's list, as opposed to one an operation names who left it: the forms only offer the former. */
export function isMember(view: GroupView, id: MemberId): boolean {
  return view.members.some((member) => member.id === id);
}

/** “Toi” for who I am, at the start of a line, or “toi” after “à”; a member's name otherwise. */
export function shortName(view: GroupView, id: MemberId, place: 'subject' | 'object' = 'subject'): string {
  if (id === view.me) {
    return place === 'subject' ? m.form_you() : m.you();
  }
  return memberOf(view, id).name;
}

/** What the balances count beyond the server's copy, and how fresh that copy is; said under each screen of the balances. */
export function syncLine(view: GroupView): string {
  const when = formatMoment(view.readAt);
  if (view.pendingCount === 0) {
    return m.balances_sync({ when });
  }
  return view.pendingCount === 1 ? m.balances_sync_pending_one({ when }) : m.balances_sync_pending({ count: String(view.pendingCount), when });
}
