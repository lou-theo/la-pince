import { z } from 'zod';

import { computeEffect, type Effect } from './effect.ts';
import { entrySchema } from './entry.ts';
import { type MemberId, memberIdSchema, operationIdSchema, revisionIdSchema } from './ids.ts';

// Far above Tricount's longest title in the group's history, and a bound on what a sent operation makes the server store.
const MAX_TITLE_LENGTH = 100;

const revisionFields = {
  id: operationIdSchema,
  revisionId: revisionIdSchema,
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  /** Calendar day, `YYYY-MM-DD`, as the person entered it; never a time, which would move the day with the time zone. */
  date: z.iso.date(),
  /** The member who entered this revision (“who I am” on the phone that sent it), when known. */
  author: memberIdSchema.optional(),
};

const entryRevisionSchema = z.strictObject({ ...revisionFields, entry: entrySchema });
const deletionSchema = z.strictObject({ ...revisionFields, deleted: z.literal(true) });

/**
 * One revision of an operation, as a phone sends it: an entry, or the mark of a deleted operation, kept so that the deletion reaches the other
 * phones like any change. Strict: a revision carrying both, or an unknown field, is rejected.
 */
export const operationSchema = z.union([entryRevisionSchema, deletionSchema]);
export type Operation = z.infer<typeof operationSchema>;

// Counter of the change that wrote the revision, given by the server; a new revision of the operation gets a new, larger one.
const seq = z.int().positive();

/** Current revision of an operation as the server sends it back, with `seq`, the counter of the change that wrote it. */
export const changeSchema = z.union([entryRevisionSchema.extend({ seq }), deletionSchema.extend({ seq })]);
export type Change = z.infer<typeof changeSchema>;

/** Effect of the operation on the accounts, computed from its entry as on every phone; none for a deleted operation. */
export function operationEffect(operation: Operation): Effect | undefined {
  return 'entry' in operation ? computeEffect(operation.id, operation.entry) : undefined;
}

/**
 * Members the operation names (payer, lines, author) that are not members of the group, each once, in that order; the server rejects an operation
 * that names one, and the phone runs the same check before queuing it.
 */
export function unknownMembers(operation: Operation, members: ReadonlySet<MemberId>): MemberId[] {
  const named = 'entry' in operation ? [operation.entry.payer, ...operation.entry.lines.map((line) => line.member)] : [];
  if (operation.author !== undefined) {
    named.push(operation.author);
  }
  return [...new Set(named)].filter((member) => !members.has(member));
}
