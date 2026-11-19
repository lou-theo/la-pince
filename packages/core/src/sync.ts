import { z } from 'zod';

import type { RevisionId } from './ids.ts';
import { changeSchema, type Operation, operationSchema } from './operation.ts';

/** Most revisions a phone sends in one request; a longer outbox is sent in several. */
export const MAX_BATCH_OPERATIONS = 50;

/** Most changes the server sends back in one page, and the page size when the phone asks for none. */
export const MAX_CHANGES = 500;

/** Revisions sent by a phone in one request, in the order they were made: the server writes them in that order, the last one arrived winning. */
export const operationBatchSchema = z.strictObject({ operations: z.array(operationSchema).min(1).max(MAX_BATCH_OPERATIONS) });
export type OperationBatch = z.infer<typeof operationBatchSchema>;

/**
 * Position in the server's history of changes: the counter of the last change a phone has received, 0 before the first. The counter only grows, so
 * asking for what changed since a cursor never misses a change, whatever the phones' clocks.
 */
export const cursorSchema = z.int().nonnegative().brand('Cursor');
export type Cursor = z.infer<typeof cursorSchema>;

// Digits only: `Number` alone would accept “1e3”, “0x10” or an empty string.
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
 * (the `seq` of the last change, or the cursor asked when nothing changed). `hasMore` says another page is waiting: balances computed before a page
 * with `hasMore: false` has been read leave out operations, and are wrong.
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
 * Revisions of a batch the server has to write, in the order they arrived: a revision already received, or met earlier in the batch, is left out.
 * The outbox resends what it is not sure arrived, so an old revision may come back after a newer one: it must not overwrite it.
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
