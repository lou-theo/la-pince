import { z } from 'zod';

import { type Cents, enteredAmountSchema } from './amount.ts';
import { type Entry, entrySchema } from './entry.ts';
import { type MemberId, memberIdSchema, type OperationId, operationIdSchema } from './ids.ts';

// Tricount writes money spent as a negative amount with two decimals (“-10.20”); a positive amount is an income, which La Pince does not model.
const TRICOUNT_AMOUNT = /^(-?)(\d+\.\d{2})$/;

const tricountCentsSchema = z.strictObject({ currency: z.literal('EUR'), value: z.string() }).transform((amount, context): Cents => {
  const parts = TRICOUNT_AMOUNT.exec(amount.value);
  const cents = enteredAmountSchema.safeParse(parts?.[2]);
  if (!cents.success) {
    context.addIssue({ code: 'custom', message: 'invalid_amount' });
    return z.NEVER;
  }
  if (parts?.[1] !== '-' && cents.data !== 0) {
    context.addIssue({ code: 'custom', message: 'income_not_supported' });
    return z.NEVER;
  }
  return cents.data;
});

// A membership is wrapped in an object keyed by its kind (`RegistryMembershipNonUser` for a member without a bunq account); the kind does not matter here.
function wrappedMembership<T extends z.ZodType>(membership: T) {
  return z.record(z.string(), membership).transform((wrapper, context): z.output<T> => {
    const [unwrapped, ...others] = Object.values(wrapper);
    if (unwrapped === undefined || others.length > 0) {
      context.addIssue({ code: 'custom', message: 'invalid_membership' });
      return z.NEVER;
    }
    return unwrapped;
  });
}

const membershipRefSchema = wrappedMembership(z.object({ uuid: memberIdSchema })).transform((membership): MemberId => membership.uuid);

const memberSchema = wrappedMembership(z.object({ uuid: memberIdSchema, alias: z.object({ display_name: z.string().min(1) }) }));

const allocationSchema = z.object({ membership: membershipRefSchema, amount: tricountCentsSchema });

// Only the fields La Pince imports; Tricount sends many more (ids, timestamps, categories), ignored.
const registryEntrySchema = z.object({
  uuid: operationIdSchema,
  status: z.literal('ACTIVE'),
  amount: tricountCentsSchema,
  description: z.string(),
  // NORMAL is an expense, BALANCE a reimbursement from the owner to the only member with a non-zero allocation.
  type_transaction: z.enum(['NORMAL', 'BALANCE']),
  membership_owned: membershipRefSchema,
  allocations: z.array(allocationSchema),
  // “2026-11-16 15:56:50.945000”: the day is what Tricount shows; the time zone of the rest is not documented.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2} /),
});

/** Export of a tricount as its Android app reads it (`registry` endpoint), restricted to what the import uses. */
export const tricountExportSchema = z.object({
  Response: z.tuple([
    z.object({
      Registry: z
        .object({
          title: z.string(),
          memberships: z.array(memberSchema),
          all_registry_entry: z.array(z.object({ RegistryEntry: registryEntrySchema })),
        })
        .superRefine((registry, context) => {
          const members = new Set(registry.memberships.map((member) => member.uuid));
          const referenced = registry.all_registry_entry.flatMap(({ RegistryEntry: operation }) => [
            operation.membership_owned,
            ...operation.allocations.map((allocation) => allocation.membership),
          ]);
          if (referenced.some((member) => !members.has(member))) {
            context.addIssue({ code: 'custom', message: 'unknown_member', path: ['all_registry_entry'] });
          }
        }),
    }),
  ]),
});

export interface ImportedMember {
  readonly id: MemberId;
  readonly name: string;
}

export interface ImportedOperation {
  readonly id: OperationId;
  readonly title: string;
  /** Calendar day, `YYYY-MM-DD`. */
  readonly date: string;
  readonly entry: Entry;
}

export interface ImportedGroup {
  readonly title: string;
  readonly members: readonly ImportedMember[];
  readonly operations: readonly ImportedOperation[];
}

/**
 * Converts a Tricount export into members and operations, keeping Tricount's identifiers so that a new import overwrites the same group.
 * Each operation becomes an entry in exact amounts equal to the shares Tricount computed, so that balances match it to the cent whatever its
 * rule for the leftover cent; a zero share is left out, its member not being involved. Throws a `ZodError` on an export it cannot read.
 */
export function convertTricount(data: unknown): ImportedGroup {
  const registry = tricountExportSchema.parse(data).Response[0].Registry;
  const members = registry.memberships.map(({ uuid, alias }) => ({ id: uuid, name: alias.display_name }));
  const operations = registry.all_registry_entry.map(({ RegistryEntry: operation }) => ({
    id: operation.uuid,
    title: operation.description,
    date: operation.date.slice(0, 10),
    entry: entrySchema.parse({
      version: 1,
      kind: operation.type_transaction === 'NORMAL' ? 'expense' : 'reimbursement',
      payer: operation.membership_owned,
      // Checked against the sum of the shares by the entry schema: an export whose allocations do not add up is rejected.
      total: operation.amount,
      lines: operation.allocations.filter((allocation) => allocation.amount !== 0).map(({ membership, amount }) => ({ member: membership, amount })),
    }),
  }));
  return { title: registry.title, members, operations };
}
