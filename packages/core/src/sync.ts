import { z } from 'zod';

import type { RevisionId } from './ids.ts';
import { changeSchema, type Operation, operationSchema } from './operation.ts';

/** Most revisions a phone sends in one request; a longer outbox is sent in several. */
export const MAX_BATCH_REVISIONS = 50;

/** Most changes the server sends back in one page, and the page size when the phone asks for none. */
export const MAX_CHANGES = 500;

/** Revisions sent by a phone in one request, in the order they were made: the server writes them in that order, the last one arrived winning. */
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

/**
 * Revisions of a batch the server has to write, in the order they arrived: a revision already received, or met earlier in the batch, is left out,
 * so that resending what the outbox is not sure arrived never writes a revision twice. A pre-sort only: two requests replaying the same revision at
 * once both find it new, so the server must also insert each revision under a unique `revisionId` and move the operation's current state only when
 * that insert took place, in the same write. Nor does it order revisions: an old revision arriving for the first time after a newer one wins, which
 * the outbox prevents by sending its revisions in order, one request at a time, without merging one it has not seen acknowledged.
 */
export function newRevisions(batch: readonly Operation[], received: ReadonlySet<RevisionId>): Operation[] {
  const seen = new Set(received);
  return batch.filter((operation) => {
    if (seen.has(operation.revisionId)) {
      return false;
    }
    seen.add(operation.revisionId);
    return true;
  });
}
