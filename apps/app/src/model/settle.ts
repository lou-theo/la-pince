import type { Member, MemberId, Operation, OperationId, RevisionId, SuggestedTransfer } from '@la-pince/core';

import { transfersByDebtor } from './balances.ts';
import type { BalanceLine } from './group.ts';
import { newReimbursement, readForm } from './operationForm.ts';

/**
 * The reimbursement that records a suggested transfer as paid, today, by who I am. It goes through the reimbursement form's reading, so that it
 * is checked as one typed by hand would be.
 */
export function settlementOf(
  transfer: SuggestedTransfer,
  { id, title, today, revisionId, author }: { id: OperationId; title: string; today: string; revisionId: RevisionId; author: MemberId },
): Operation {
  const form = newReimbursement({ id, title, today, from: transfer.from, to: transfer.to, amount: transfer.amount });
  const read = readForm(form, { revisionId, author });
  if (!read.ok) {
    throw new Error(`A suggested transfer does not read as a reimbursement: ${JSON.stringify(read.errors)}`);
  }
  return read.value;
}

/** A suggested transfer recorded on this screen by “C'est payé”, with what its deletion needs to undo it. */
export interface PaidTransfer {
  readonly transfer: SuggestedTransfer;
  readonly operation: { readonly id: OperationId; readonly title: string; readonly date: string };
}

/** A line of the transfers: one still to pay, or one paid on this screen. */
export type TransferRow = { readonly kind: 'due'; readonly transfer: SuggestedTransfer } | ({ readonly kind: 'paid' } & PaidTransfer);

/**
 * The lines of a list of transfers: those paid on this screen first, in the order they were paid, then those still due. A paid one shows only while
 * its reimbursement is `live`: undone, or deleted by someone else, it leaves, and the transfers computed again bring it back if it is still due.
 */
export function transferRows(due: readonly SuggestedTransfer[], paid: readonly PaidTransfer[], live: ReadonlySet<OperationId>): TransferRow[] {
  return [
    ...paid.filter((line) => live.has(line.operation.id)).map((line) => ({ kind: 'paid' as const, ...line })),
    ...due.map((transfer) => ({ kind: 'due' as const, transfer })),
  ];
}

/** A card of the transfers screen: who owes, what they still owe, and their lines. */
export interface DebtorCard {
  readonly debtor: MemberId;
  readonly total: number;
  readonly rows: readonly TransferRow[];
}

/**
 * The cards of the transfers screen. Debtors come in `order`, the order of the screen when it opened, so that nobody moves under the finger as the
 * balances change; one who was not in it comes after, in the order of `transfersByDebtor`. A debtor who paid everything keeps their card while a
 * line of theirs paid on this screen is live.
 */
export function debtorCards(
  transfers: readonly SuggestedTransfer[],
  members: readonly Member[],
  paid: readonly PaidTransfer[],
  live: ReadonlySet<OperationId>,
  order: readonly MemberId[],
): DebtorCard[] {
  const owed = new Map(transfersByDebtor(transfers, members).map((debtor) => [debtor.debtor, debtor]));
  const debtors = [...owed.keys()];
  for (const line of paid) {
    if (live.has(line.operation.id) && !debtors.includes(line.transfer.from)) {
      debtors.push(line.transfer.from);
    }
  }
  const rank = (debtor: MemberId) => {
    const index = order.indexOf(debtor);
    return index === -1 ? order.length : index;
  };
  return debtors
    .toSorted((a, b) => rank(a) - rank(b))
    .map((debtor) => ({
      debtor,
      total: owed.get(debtor)?.total ?? 0,
      rows: transferRows(
        owed.get(debtor)?.transfers ?? [],
        paid.filter((line) => line.transfer.from === debtor),
        live,
      ),
    }));
}

/** The balance said under the fields of a reimbursement: of who gives it, or of who receives it while the giver is not chosen. */
export function balanceContext(
  payer: MemberId | undefined,
  receiver: MemberId | undefined,
  balances: readonly BalanceLine[],
): BalanceLine | undefined {
  const member = payer ?? receiver;
  return balances.find((line) => line.member.id === member);
}

/**
 * Members the free reimbursement page offers for one side, in the order of the balances (the group owes the first the most), without the member of
 * the other side, nobody reimbursing themselves, nor a member who left the group.
 */
export function candidates(balances: readonly BalanceLine[], members: readonly Member[], other: MemberId | undefined): Member[] {
  const inGroup = new Set(members.map((member) => member.id));
  return balances.map((line) => line.member).filter((member) => inGroup.has(member.id) && member.id !== other);
}
