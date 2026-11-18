import type { Cents } from './amount.ts';
import type { Entry, EntryLine } from './entry.ts';
import { compareIds, type MemberId, type OperationId } from './ids.ts';

export interface Share {
  readonly member: MemberId;
  readonly amount: Cents;
}

/** What an operation changes to the accounts: its payer and the non-zero share of each involved member, ordered by member, summing to the total. */
export interface Effect {
  readonly payer: MemberId;
  readonly total: Cents;
  readonly shares: readonly Share[];
}

type WeightedLine = Extract<EntryLine, { weight: number }>;

// FNV-1a on 32 bits, as in Spliit (src/lib/shares.ts at f293974, MIT): seeding the leftover cent with the operation id keeps the effect a pure
// function of the operation while moving the extra cent from one member to another across operations.
function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

/**
 * Shares `amount` out by weight, by largest remainder (Hamilton apportionment, as in Spliit): every line gets the floor of its exact share,
 * then the cents left go to the largest remainders, ties broken by a rotation of the lines seeded by the operation id.
 */
function apportion(operationId: OperationId, amount: number, lines: readonly WeightedLine[]): { member: MemberId; amount: number }[] {
  const totalWeight = lines.reduce((sum, line) => sum + line.weight, 0);
  const offset = hash(operationId) % lines.length;
  const parts = lines.map((line, index) => {
    const exact = amount * line.weight;
    const floor = Math.floor(exact / totalWeight);
    return { member: line.member, floor, remainder: exact - floor * totalWeight, rotated: (index - offset + lines.length) % lines.length };
  });
  const left = amount - parts.reduce((sum, part) => sum + part.floor, 0);
  const extra = new Set(
    parts
      .toSorted((a, b) => (a.remainder === b.remainder ? a.rotated - b.rotated : b.remainder - a.remainder))
      .slice(0, left)
      .map((part) => part.member),
  );
  return parts.map((part) => ({ member: part.member, amount: part.floor + (extra.has(part.member) ? 1 : 0) }));
}

/** Computes the effect of an operation from its entry; the same function runs on the phone and on the server. */
export function computeEffect(operationId: OperationId, entry: Entry): Effect {
  const lines = entry.lines.toSorted((a, b) => compareIds(a.member, b.member));
  const fixed = lines.flatMap((line) => ('amount' in line ? [{ member: line.member, amount: line.amount }] : []));
  const weighted = lines.filter((line): line is WeightedLine => 'weight' in line);
  const fixedTotal = fixed.reduce((sum, share) => sum + share.amount, 0);
  const total = entry.total ?? fixedTotal;
  const apportioned = weighted.length > 0 ? apportion(operationId, total - fixedTotal, weighted) : [];
  const shares = [...fixed, ...apportioned].filter((share) => share.amount > 0).toSorted((a, b) => compareIds(a.member, b.member));
  // Amounts come out of a validated entry and of the apportionment above, which preserves their sum: they are whole, non-negative and capped.
  return { payer: entry.payer, total: total as Cents, shares: shares as Share[] };
}
