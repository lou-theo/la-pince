import { z } from 'zod';

import { type Cents, enteredAmountSchema } from './amount.ts';
import { type Entry, entrySchema } from './entry.ts';
import { type MemberId, memberIdSchema, type OperationId, operationIdSchema } from './ids.ts';

// Tricount writes money spent as a negative amount with two decimals (“-10.20”), and a zero share unsigned or not; a positive amount is an
// income, which La Pince does not model.
const TRICOUNT_AMOUNT = /^(-?)(\d+\.\d{2})$/;

// Strict, unlike the rest of the export: a field added to an amount (a second currency, a rate) could change what it means.
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

const DATE = /^(\d{4}-\d{2}-\d{2}) /;

export interface ImportedOperation {
  readonly id: OperationId;
  readonly title: string;
  /** Calendar day, `YYYY-MM-DD`. */
  readonly date: string;
  readonly entry: Entry;
}

// Only the fields La Pince imports; Tricount sends many more (ids, timestamps, categories), ignored.
const registryEntrySchema = z
  .object({
    uuid: operationIdSchema,
    status: z.literal('ACTIVE'),
    amount: tricountCentsSchema,
    description: z.string(),
    // NORMAL is an expense, BALANCE a reimbursement from the owner to the one other member allocated the amount.
    type_transaction: z.enum(['NORMAL', 'BALANCE']),
    membership_owned: membershipRefSchema,
    allocations: z.array(allocationSchema),
    // “2026-11-16 15:56:50.945000”: the day is what Tricount shows; the time zone of the rest is not documented.
    date: z.string().refine((date) => z.iso.date().safeParse(DATE.exec(date)?.[1]).success, 'invalid_date'),
  })
  // The members the operation names, zero shares included, are kept for the group's checks.
  .transform((operation, context): { operation: ImportedOperation; members: readonly MemberId[] } => {
    const members = operation.allocations.map((allocation) => allocation.membership);
    // Checked before zero shares are dropped, which would hide a member allocated twice.
    if (new Set(members).size !== members.length) {
      context.addIssue({ code: 'custom', message: 'duplicate_allocation', path: ['allocations'] });
    }
    const lines = operation.allocations
      .filter((allocation) => allocation.amount !== 0)
      .map(({ membership, amount }) => ({ member: membership, amount }));
    if (operation.type_transaction === 'BALANCE' && (lines.length !== 1 || lines[0]?.member === operation.membership_owned)) {
      context.addIssue({ code: 'custom', message: 'unsupported_reimbursement', path: ['allocations'] });
    }
    const entry = entrySchema.safeParse({
      version: 1,
      kind: operation.type_transaction === 'NORMAL' ? 'expense' : 'reimbursement',
      payer: operation.membership_owned,
      // Checked against the sum of the shares by the entry schema: an export whose allocations do not add up is rejected.
      total: operation.amount,
      lines,
    });
    if (!entry.success) {
      // Reported under the operation, so that an error names which of the operations to look at.
      for (const issue of entry.error.issues) {
        context.addIssue({ ...issue, path: ['entry', ...issue.path] });
      }
      return z.NEVER;
    }
    return {
      operation: { id: operation.uuid, title: operation.description, date: operation.date.slice(0, 10), entry: entry.data },
      members: [operation.membership_owned, ...members],
    };
  });

const noPage = z.null({ error: 'partial_export' });

const tricountExportSchema = z.object({
  Response: z.tuple([
    z.object({
      Registry: z
        .object({
          title: z.string(),
          memberships: z.array(memberSchema),
          all_registry_entry: z.array(z.object({ RegistryEntry: registryEntrySchema })),
        })
        // A transform rather than a refinement: it only runs once every operation has been converted, which these checks read.
        .transform((registry, context) => {
          const members = new Set(registry.memberships.map((member) => member.uuid));
          if (members.size !== registry.memberships.length) {
            context.addIssue({ code: 'custom', message: 'duplicate_member', path: ['memberships'] });
          }
          const seen = new Set<OperationId>();
          registry.all_registry_entry.forEach(({ RegistryEntry: { operation, members: referenced } }, index) => {
            if (seen.has(operation.id)) {
              context.addIssue({ code: 'custom', message: 'duplicate_operation', path: ['all_registry_entry', index] });
            }
            seen.add(operation.id);
            if (referenced.some((member) => !members.has(member))) {
              context.addIssue({ code: 'custom', message: 'unknown_member', path: ['all_registry_entry', index] });
            }
          });
          return { ...registry, all_registry_entry: registry.all_registry_entry.map(({ RegistryEntry: { operation } }) => operation) };
        }),
    }),
  ]),
  // The whole group must come in one page: a page left behind would silently leave operations out of the balances.
  Pagination: z.object({ older_url: noPage, newer_url: noPage, future_url: noPage }),
});

export interface ImportedMember {
  readonly id: MemberId;
  readonly name: string;
}

export interface ImportedGroup {
  readonly title: string;
  readonly members: readonly ImportedMember[];
  readonly operations: readonly ImportedOperation[];
}

/**
 * Converts a Tricount export (its Android app's `registry` endpoint) into members and operations, keeping Tricount's identifiers so that a new
 * import overwrites the same group. Each operation becomes an entry in exact amounts equal to the shares Tricount computed, so that balances
 * match it to the cent whatever its rule for the leftover cent; a zero share is left out, its member not being involved. Anything else than
 * what the group's export holds is rejected rather than approximated: throws a `ZodError` whose issues give the path of the faulty operation.
 */
export function convertTricount(data: unknown): ImportedGroup {
  const registry = tricountExportSchema.parse(data).Response[0].Registry;
  return {
    title: registry.title,
    members: registry.memberships.map(({ uuid, alias }) => ({ id: uuid, name: alias.display_name })),
    operations: registry.all_registry_entry,
  };
}
