import {
  type GroupId,
  groupIdSchema,
  memberIdSchema,
  operationIdSchema,
  type RevisionId,
  revisionIdSchema,
  type RevisionResult,
} from '@la-pince/core';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { type BatchContext, decideRevisions } from './revisions.ts';
import { members, operations, revisions } from './schema.ts';

/** A revision of the batch, as the envelope gave it: its id and the rest, judged later against the schemas of the core. */
export interface BatchItem {
  readonly revisionId: RevisionId;
  readonly raw: Readonly<Record<string, unknown>>;
}

/** A revision to write: the group's revision of an operation, its content in canonical JSON. */
export interface RevisionWrite {
  readonly revisionId: RevisionId;
  readonly operationId: string;
  readonly content: string;
}

/** Reads what the batch's revisions meet in the database: the group's members, the revisions already received, the group of each known operation. */
export async function readBatchContext(db: D1Database, groupId: GroupId, batch: readonly BatchItem[]): Promise<BatchContext> {
  const orm = drizzle(db);
  const operationIds = batch.flatMap(({ raw }) => {
    const id = operationIdSchema.safeParse(raw.id);
    return id.success ? [id.data] : [];
  });
  const [memberRows, revisionRows, operationRows] = await Promise.all([
    orm.select({ id: members.id }).from(members).where(eq(members.groupId, groupId)),
    orm
      .select({ revisionId: revisions.revisionId, groupId: revisions.groupId, content: revisions.content })
      .from(revisions)
      .where(
        inArray(
          revisions.revisionId,
          batch.map((item) => item.revisionId),
        ),
      ),
    operationIds.length === 0
      ? []
      : orm.select({ id: operations.id, groupId: operations.groupId }).from(operations).where(inArray(operations.id, operationIds)),
  ]);
  return {
    groupId,
    members: new Set(memberRows.map((row) => memberIdSchema.parse(row.id))),
    storedRevisions: new Map(
      revisionRows.map((row) => [revisionIdSchema.parse(row.revisionId), { groupId: groupIdSchema.parse(row.groupId), content: row.content }]),
    ),
    operationGroups: new Map(operationRows.map((row) => [operationIdSchema.parse(row.id), groupIdSchema.parse(row.groupId)])),
  };
}

/**
 * Writes the revisions in one D1 batch, D1's transaction, and returns the seq of each revision this call wrote. A revision already received, or
 * whose operation belongs to another group, is left out, even when another request wrote it after the context was read: the guards live in the
 * statements, not in the reads before them.
 */
export async function writeRevisions(db: D1Database, groupId: GroupId, writes: readonly RevisionWrite[]): Promise<Map<RevisionId, number>> {
  if (writes.length === 0) {
    return new Map();
  }
  // Raw statements: Drizzle's D1 batch takes neither an `INSERT … SELECT … WHERE` nor `changes()`. Table and column names follow `schema.ts`.
  const statements = writes.flatMap(({ revisionId, operationId, content }) => [
    db
      .prepare(
        `INSERT INTO revisions (revision_id, group_id, operation_id, content)
         SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM operations WHERE id = ? AND group_id <> ?)
         ON CONFLICT DO NOTHING RETURNING seq`,
      )
      .bind(revisionId, groupId, operationId, content, operationId, groupId),
    // `changes()` counts the rows of the insert just above: the current state moves only for a revision this statement pair wrote, never for a
    // replay (`last_insert_rowid()` would not tell, it keeps the last insert of the connection). The upsert's own guards, a last resort, keep it in its group and from going back.
    db
      .prepare(
        `INSERT INTO operations (id, group_id, seq, created_seq, content)
         SELECT ?, ?, seq, seq, ? FROM revisions WHERE revision_id = ? AND changes() = 1
         ON CONFLICT (id) DO UPDATE SET seq = excluded.seq, content = excluded.content
         WHERE operations.group_id = excluded.group_id AND excluded.seq > operations.seq`,
      )
      .bind(operationId, groupId, content, revisionId),
  ]);
  const results = await db.batch<{ seq: number }>(statements);
  return new Map(
    writes.flatMap((write, index) => {
      const seq = results[index * 2]?.results[0]?.seq;
      return seq === undefined ? [] : [[write.revisionId, seq] as const];
    }),
  );
}

/**
 * Judges the batch against a context read before, writes what it can, and answers each revision in the order sent. A revision a concurrent
 * request took between the read and the write is judged again on a fresh read, so that it gets the same answer as if it had come later.
 */
export async function settleBatch(db: D1Database, batch: readonly BatchItem[], context: BatchContext): Promise<RevisionResult[]> {
  const decisions = decideRevisions(batch, context);
  const writes = decisions.flatMap((decision) =>
    decision.status === 'write' ? [{ revisionId: decision.revisionId, operationId: decision.operation.id, content: decision.content }] : [],
  );
  const written = await writeRevisions(db, context.groupId, writes);
  const raced = batch.filter((item) => writes.some((write) => write.revisionId === item.revisionId) && !written.has(item.revisionId));
  // Rows are never deleted, so a fresh read sees what blocked the write: the second pass writes nothing and ends.
  const judgedAgain = raced.length === 0 ? [] : await applyBatch(db, context.groupId, raced);
  return decisions.map((decision): RevisionResult => {
    if (decision.status !== 'write') {
      return decision;
    }
    const seq = written.get(decision.revisionId);
    if (seq !== undefined) {
      return { revisionId: decision.revisionId, status: 'written', seq };
    }
    const again = judgedAgain.find((result) => result.revisionId === decision.revisionId);
    // Never taken: every revision left unwritten went through the second pass. Only there for the type.
    /* v8 ignore next */
    return again ?? { revisionId: decision.revisionId, status: 'rejected', reason: 'revision_conflict' };
  });
}

/** Reads the context, then settles the batch. */
export async function applyBatch(db: D1Database, groupId: GroupId, batch: readonly BatchItem[]): Promise<RevisionResult[]> {
  return settleBatch(db, batch, await readBatchContext(db, groupId, batch));
}
