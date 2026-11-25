import type { Member, MemberId } from '@la-pince/core';

import type { OperationView } from './group.ts';

const WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

/**
 * Order of the members to choose from in a form (docs/decisions/ordre-des-membres.md): who I am first, then the members named by the most operations (as payer or with a
 * share) over the 90 days before the group's last operation, ties in the order members were added.
 */
export function selectionOrder(members: readonly Member[], me: MemberId, operations: readonly OperationView[]): Member[] {
  // Days are ISO strings, compared as such; the window is anchored on the last operation so that an idle group keeps a useful order.
  const last = operations.reduce<string | undefined>(
    (latest, operation) => (latest === undefined || operation.date > latest ? operation.date : latest),
    undefined,
  );
  const counts = new Map<MemberId, number>();
  if (last !== undefined) {
    const from = new Date(Date.parse(`${last}T00:00:00Z`) - WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
    for (const operation of operations) {
      if (operation.date > from) {
        const named = new Set([operation.effect.payer, ...operation.effect.shares.map((share) => share.member)]);
        for (const member of named) {
          counts.set(member, (counts.get(member) ?? 0) + 1);
        }
      }
    }
  }
  const rank = (member: Member) => (member.id === me ? Number.POSITIVE_INFINITY : (counts.get(member.id) ?? 0));
  return members
    .map((member, position) => ({ member, position }))
    .sort((a, b) => (rank(a.member) === rank(b.member) ? a.position - b.position : rank(b.member) - rank(a.member)))
    .map(({ member }) => member);
}
