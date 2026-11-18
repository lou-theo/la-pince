import type { Effect } from './effect.ts';
import type { MemberId } from './ids.ts';

/** What a member paid minus the sum of their shares, in cents; positive, the group owes them money. */
export type Balance = number;

/** Balances of every member that appears in the effects, as payer or involved; they always sum to zero. */
export function computeBalances(effects: Iterable<Effect>): Map<MemberId, Balance> {
  const balances = new Map<MemberId, Balance>();
  for (const effect of effects) {
    balances.set(effect.payer, (balances.get(effect.payer) ?? 0) + effect.total);
    for (const share of effect.shares) {
      balances.set(share.member, (balances.get(share.member) ?? 0) - share.amount);
    }
  }
  return balances;
}
