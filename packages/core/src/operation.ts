import { z } from 'zod';

import { computeEffect, type Effect } from './effect.ts';
import { entrySchema } from './entry.ts';
import { type MemberId, memberIdSchema, operationIdSchema, revisionIdSchema } from './ids.ts';
import { textSchema } from './text.ts';

// Far above the longest title of the group's history (41 characters); bounds what a sent operation makes the server store.
const MAX_TITLE_LENGTH = 100;

/** Title of an operation, shared with the Tricount conversion so that an import never sends a title the server rejects. */
export const operationTitleSchema = textSchema(MAX_TITLE_LENGTH);

const revisionFields = {
  id: operationIdSchema,
  revisionId: revisionIdSchema,
  title: operationTitleSchema,
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

/** Given by the server to each revision it writes, from a counter that only grows: a new revision of the operation gets a larger one. */
export const seqSchema = z.int().positive();

// `createdSeq`, the seq of the operation's first revision, does not move when the operation changes: it orders operations as they were entered.
const changeFields = { seq: seqSchema, createdSeq: seqSchema };

/** Current revision of an operation as the server sends it back, with the seq that wrote it and the seq of the operation's first revision. */
export const changeSchema = z
  .union([entryRevisionSchema.extend(changeFields), deletionSchema.extend(changeFields)])
  .refine((change) => change.createdSeq <= change.seq, { message: 'created_after_change', path: ['createdSeq'] });
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
