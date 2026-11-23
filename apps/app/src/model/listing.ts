import type { MemberId } from '@la-pince/core';

import { myShare, type OperationView } from './group.ts';

/**
 * What an operation means for “who I am”, as its line in the list says it in words: an expense someone else paid puts my share on me (`owe`); one I
 * paid makes me advance what the others owe (`advanced`), or only my own share when nobody else is in it (`own`); a reimbursement is `received` or
 * `sent`; anything else does not involve me.
 */
export type MyPart = { readonly kind: 'owe' | 'advanced' | 'own' | 'received' | 'sent'; readonly amount: number } | { readonly kind: 'not_involved' };

export function myPart(operation: Pick<OperationView, 'kind' | 'effect'>, me: MemberId): MyPart {
  const { payer, total } = operation.effect;
  const share = myShare(operation.effect, me);
  if (operation.kind === 'reimbursement') {
    if (payer === me) {
      return { kind: 'sent', amount: total };
    }
    return share > 0 ? { kind: 'received', amount: share } : { kind: 'not_involved' };
  }
  if (payer === me) {
    return total - share > 0 ? { kind: 'advanced', amount: total - share } : { kind: 'own', amount: share };
  }
  return share > 0 ? { kind: 'owe', amount: share } : { kind: 'not_involved' };
}

export interface Day<T> {
  /** `YYYY-MM-DD`. */
  readonly day: string;
  readonly operations: readonly T[];
}

/** Operations already in the order of the list, cut into one run per day, so that the day is said once above its operations. */
export function byDay<T extends { readonly date: string }>(operations: readonly T[]): Day<T>[] {
  const days: { day: string; operations: T[] }[] = [];
  for (const operation of operations) {
    const last = days.at(-1);
    if (last?.day === operation.date) {
      last.operations.push(operation);
    } else {
      days.push({ day: operation.date, operations: [operation] });
    }
  }
  return days;
}
