import type { MemberId, SuggestedTransfer } from '@la-pince/core';

import { m } from '../i18n/paraglide/messages.js';
import type { BalanceLine, OperationView } from '../model/group.ts';

/** What the group's screens read: its live operations and balances, computed once per read of the group, seen as “who I am”. */
export interface GroupView {
  readonly operations: readonly OperationView[];
  readonly balances: readonly BalanceLine[];
  readonly transfers: readonly SuggestedTransfer[];
  readonly me: MemberId;
  readonly nameOf: (id: MemberId) => string;
  /** Members in the order they were added, which orders the lines of a split. */
  readonly memberOrder: readonly MemberId[];
}

/** Who paid an expense, or who reimbursed whom. */
export function who(view: GroupView, operation: OperationView): string {
  const { payer, shares } = operation.effect;
  if (operation.kind === 'reimbursement') {
    // A reimbursement's lines are the members who received it, a single one from Tricount.
    return m.operation_reimbursed({ from: view.nameOf(payer), to: shares.map((share) => view.nameOf(share.member)).join(', ') });
  }
  return m.operation_paid_by({ name: view.nameOf(payer) });
}
