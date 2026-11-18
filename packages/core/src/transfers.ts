import type { Balance } from './balances.ts';
import { compareIds, type MemberId } from './ids.ts';

/** Transfer suggested to bring balances back to zero; not an operation until it is recorded. */
export interface SuggestedTransfer {
  readonly from: MemberId;
  readonly to: MemberId;
  /** Whole, positive number of cents; not `Cents`, a balance being able to exceed the cap of one entered amount. */
  readonly amount: number;
}

/**
 * Greedy settlement as in Spliit (src/lib/balances.ts at f293974, MIT): creditors first, then debtors, each in a fixed order by member id;
 * the first creditor and the last debtor settle as much as they can, and whoever reaches zero leaves. The fixed order keeps the next
 * suggestions unchanged once a suggested transfer is recorded.
 */
export function suggestTransfers(balances: ReadonlyMap<MemberId, Balance>): SuggestedTransfer[] {
  const entries = [...balances].toSorted(([a], [b]) => compareIds(a, b));
  if (entries.reduce((sum, [, balance]) => sum + balance, 0) !== 0) {
    throw new Error('Balances must sum to zero.');
  }
  const creditors = entries.filter(([, balance]) => balance > 0).values();
  const debtors = entries
    .filter(([, balance]) => balance < 0)
    .reverse()
    .values();
  const transfers: SuggestedTransfer[] = [];
  let creditor = creditors.next();
  let debtor = debtors.next();
  // Both run out together, the balances summing to zero.
  while (creditor.done !== true && debtor.done !== true) {
    const [to, credit] = creditor.value;
    const [from, debt] = debtor.value;
    const amount = Math.min(credit, -debt);
    transfers.push({ from, to, amount });
    creditor = credit === amount ? creditors.next() : { done: false, value: [to, credit - amount] };
    debtor = -debt === amount ? debtors.next() : { done: false, value: [from, debt + amount] };
  }
  return transfers;
}
