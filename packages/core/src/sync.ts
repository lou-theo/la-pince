import { z } from 'zod';

import { revisionIdSchema } from './ids.ts';
import { changeSchema, operationSchema, seqSchema } from './operation.ts';

/** Most revisions a phone sends in one request; a longer outbox is sent in several. */
export const MAX_BATCH_REVISIONS = 50;

/** Most changes the server sends back in one page, and the page size when the phone asks for none. */
export const MAX_CHANGES = 500;

/**
 * Revisions sent by a phone in one request, in the order they were made: the server writes them in that order, the last one arrived winning. The
 * outbox sends its revisions in order, one request at a time, without merging one it has not seen acknowledged: an old revision arriving for the
 * first time after a newer one would win.
 */
export const operationBatchSchema = z.strictObject({ operations: z.array(operationSchema).min(1).max(MAX_BATCH_REVISIONS) });
export type OperationBatch = z.infer<typeof operationBatchSchema>;

/**
 * Position in the server's history of changes: the counter of the last change a phone has received, 0 before the first. The counter only grows, so
 * asking for what changed since a cursor never misses a change, whatever the phones' clocks.
 */
export const cursorSchema = z.int().nonnegative().brand('Cursor');
export type Cursor = z.infer<typeof cursorSchema>;

// Digits only: `Number` alone would accept “1e3”, “0x10” or an empty string; 15 digits stay an exact integer.
const queryIntegerSchema = z
  .string()
  .regex(/^\d{1,15}$/)
  .transform(Number);

/** Query of a read of the changes (`?since=&limit=`), as strings; other parameters are ignored. */
export const changesQuerySchema = z.object({
  since: queryIntegerSchema.pipe(cursorSchema).default(cursorSchema.parse(0)),
  limit: queryIntegerSchema.pipe(z.int().min(1).max(MAX_CHANGES)).default(MAX_CHANGES),
});
export type ChangesQuery = z.infer<typeof changesQuerySchema>;

/**
 * Page of changes since a cursor: the current revision of each operation changed since then, by increasing `seq`, and the cursor to ask from next
 * (the `seq` of the last change, or the cursor asked when nothing changed, which `pageFollowsQuery` checks). `hasMore` says another page is waiting:
 * balances computed before a page with `hasMore: false` has been read leave out operations, and are wrong.
 */
export const changesResponseSchema = z
  .strictObject({
    changes: z.array(changeSchema).max(MAX_CHANGES),
    cursor: cursorSchema,
    hasMore: z.boolean(),
  })
  .superRefine((page, context) => {
    // A seq is positive: 0 is below the first one.
    let previous = 0;
    for (const { seq } of page.changes) {
      if (seq <= previous) {
        context.addIssue({ code: 'custom', message: 'unordered_changes', path: ['changes'] });
        break;
      }
      previous = seq;
    }
    const last = page.changes.at(-1)?.seq;
    if (last === undefined ? page.hasMore : page.cursor !== last) {
      // An empty page with more to come, or a cursor behind or past the last change, would make the phone skip or loop over changes.
      context.addIssue({ code: 'custom', message: 'inconsistent_cursor', path: ['cursor'] });
    }
  });
export type ChangesResponse = z.infer<typeof changesResponseSchema>;

/**
 * Whether a page answers the query it was asked with: no longer than asked, only changes after the cursor asked, and the same cursor back when
 * nothing changed. A server that answered otherwise would make the phone read everything again, or skip the changes to come.
 */
export function pageFollowsQuery(query: ChangesQuery, page: ChangesResponse): boolean {
  const first = page.changes[0]?.seq;
  return page.changes.length <= query.limit && (first === undefined ? page.cursor === query.since : first > query.since);
}

/** Why the server refused one revision of a batch; the other revisions of the batch are applied all the same. */
export const rejectionReasonSchema = z.enum([
  // The revision does not match `operationSchema`: unknown field, entry that does not add up, malformed title.
  'invalid_operation',
  // The payer, a line or the author is not a member of the group (`unknownMembers`).
  'unknown_member',
  // The operation id belongs to another group.
  'operation_in_other_group',
  // The revision id was already received with another content, or in another group.
  'revision_conflict',
]);
export type RejectionReason = z.infer<typeof rejectionReasonSchema>;

/**
 * Outcome of one revision: `written` with the seq it got, `duplicate` when the same revision had already been received (a resend), or `rejected`
 * with its reason. The outbox drops the revision in all three cases, so that no revision blocks the ones behind it. The phone shows the server's
 * copy of each operation overlaid with the revisions still in its outbox: a rejected revision leaves the outbox and its operation falls back to the
 * server's copy. The cursor moves only by reading changes, never by the seq of a `written` answer, which may come after changes not read yet.
 */
export const revisionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ revisionId: revisionIdSchema, status: z.literal('written'), seq: seqSchema }),
  z.strictObject({ revisionId: revisionIdSchema, status: z.literal('duplicate') }),
  z.strictObject({ revisionId: revisionIdSchema, status: z.literal('rejected'), reason: rejectionReasonSchema }),
]);
export type RevisionResult = z.infer<typeof revisionResultSchema>;

/** Answer to a batch: one result per revision sent, in the same order. */
export const operationBatchResponseSchema = z.strictObject({ results: z.array(revisionResultSchema).min(1).max(MAX_BATCH_REVISIONS) });
export type OperationBatchResponse = z.infer<typeof operationBatchResponseSchema>;

/**
 * Error of a whole request. `invalid_request`: a body or a query the server cannot read, a bug of the client; `group_not_found`: no group behind the
 * link; `cursor_ahead`: the cursor is past the group's last change (the server's history was rebuilt), so the phone drops its copy of the group and
 * reads again from 0; `unauthorized`: missing or wrong admin token; `token_in_use`: the admin route was given the link token of another group.
 */
export const apiErrorSchema = z.strictObject({
  error: z.enum(['invalid_request', 'group_not_found', 'cursor_ahead', 'unauthorized', 'token_in_use']),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
