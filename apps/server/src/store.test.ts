import { type GroupId, groupIdSchema, type RevisionId, revisionIdSchema } from '@la-pince/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';

import type { Env } from './index.ts';
import { readBatchContext, settleBatch, writeRevisions } from './store.ts';

// The statements run against the local D1 of workerd, called from the tests: a concurrent request is played by a context read before the writes.
const server = createTestHarness({ workers: [{ configPath: './wrangler.jsonc' }] });
let db: D1Database;

beforeAll(async () => {
  await server.listen();
  await server.getWorker().applyD1Migrations('DB');
  db = (await server.getWorker<Env>().getEnv()).DB;
});

afterAll(async () => {
  await server.close();
});

let groups = 0;
const newGroup = async (): Promise<GroupId> => {
  groups += 1;
  const id = groupIdSchema.parse(`store${String(groups)}`);
  await db.batch([
    db.prepare('INSERT INTO groups (id, token_hash, title) VALUES (?, ?, ?)').bind(id, `hash-${id}`, 'Trip'),
    db.prepare("INSERT INTO members (group_id, id, name, position) VALUES (?, 'alice', 'Alice', 0), (?, 'bob', 'Bob', 1)").bind(id, id),
  ]);
  return id;
};

const revisionId = (id: string): RevisionId => revisionIdSchema.parse(id);
const write = (revision: string, operationId: string, content: string) => ({ revisionId: revisionId(revision), operationId, content });

const currentState = (operationId: string) =>
  db.prepare('SELECT group_id AS groupId, seq, created_seq AS createdSeq, content FROM operations WHERE id = ?').bind(operationId).first();
const storedRevisions = async (operationId: string) =>
  (await db.prepare('SELECT revision_id AS revisionId FROM revisions WHERE operation_id = ? ORDER BY seq').bind(operationId).all()).results;

describe('writeRevisions', () => {
  it('creates then updates an operation in one batch, keeping the seq of its creation', async () => {
    const group = await newGroup();
    const written = await writeRevisions(db, group, [write('s1-r1', 's1', 'first'), write('s1-r2', 's1', 'second')]);
    const [created, updated] = [written.get(revisionId('s1-r1')), written.get(revisionId('s1-r2'))];
    expect(created).toBeLessThan(updated ?? 0);
    expect(await currentState('s1')).toStrictEqual({ groupId: group, seq: updated, createdSeq: created, content: 'second' });
  });

  it('leaves the current state alone when a raced replay of its latest revision comes with another content', async () => {
    const group = await newGroup();
    await writeRevisions(db, group, [write('s2-r1', 's2', 'first')]);
    const latest = await writeRevisions(db, group, [write('s2-r2', 's2', 'second')]);
    expect(await writeRevisions(db, group, [write('s2-r2', 's2', 'other')])).toStrictEqual(new Map());
    expect(await currentState('s2')).toMatchObject({ seq: latest.get(revisionId('s2-r2')), content: 'second' });
  });

  it('keeps the newer revision when an older one is replayed after it, behind a new operation of the same batch', async () => {
    const group = await newGroup();
    await writeRevisions(db, group, [write('s3-r1', 's3', 'first'), write('s3-r2', 's3', 'second')]);
    const latest = await writeRevisions(db, group, [write('s3-r3', 's3', 'third')]);
    const replay = await writeRevisions(db, group, [write('s4-r1', 's4', 'new'), write('s3-r2', 's3', 'second')]);
    expect([...replay.keys()]).toStrictEqual(['s4-r1']);
    expect(await currentState('s3')).toMatchObject({ seq: latest.get(revisionId('s3-r3')), content: 'third' });
  });

  it('writes nothing, not even the revision, for an operation another group took', async () => {
    const [owner, other] = [await newGroup(), await newGroup()];
    await writeRevisions(db, owner, [write('s5-r1', 's5', 'mine')]);
    expect(await writeRevisions(db, other, [write('s5-r2', 's5', 'theirs')])).toStrictEqual(new Map());
    expect(await currentState('s5')).toMatchObject({ groupId: owner, content: 'mine' });
    expect(await storedRevisions('s5')).toStrictEqual([{ revisionId: 's5-r1' }]);
  });
});

describe('settleBatch', () => {
  const expense = (id: string, revision: string, total = 1000) => ({
    revisionId: revisionId(revision),
    raw: {
      id,
      revisionId: revision,
      title: 'Groceries',
      date: '2026-11-16',
      entry: { version: 1, kind: 'expense', payer: 'alice', lines: [{ member: 'bob', amount: total }] },
    },
  });

  it('judges again on a fresh read the revisions a concurrent request took after the context was read, and writes the others', async () => {
    const [group, other] = [await newGroup(), await newGroup()];
    const batch = [expense('s6', 's6-r1'), expense('s7', 's7-r1'), expense('s8', 's8-r1'), expense('s9', 's9-r1')];
    // The context is read before the concurrent request writes.
    const stale = await readBatchContext(db, group, batch);
    await settleBatch(db, [expense('s6', 's6-r1'), expense('s7', 's7-r1', 2000)], await readBatchContext(db, group, batch));
    await settleBatch(db, [expense('s8', 's8-r0')], await readBatchContext(db, other, batch));
    expect(await settleBatch(db, batch, stale)).toStrictEqual([
      { revisionId: 's6-r1', status: 'duplicate' },
      { revisionId: 's7-r1', status: 'rejected', reason: 'revision_conflict' },
      { revisionId: 's8-r1', status: 'rejected', reason: 'operation_in_other_group' },
      { revisionId: 's9-r1', status: 'written', seq: expect.any(Number) as number },
    ]);
  });

  it('refuses a revision outside the schema of an operation, without reading any operation for it', async () => {
    const group = await newGroup();
    const batch = [{ revisionId: revisionId('s10-r1'), raw: { id: 'not an id!', revisionId: 's10-r1' } }];
    expect(await settleBatch(db, batch, await readBatchContext(db, group, batch))).toStrictEqual([
      { revisionId: 's10-r1', status: 'rejected', reason: 'invalid_operation' },
    ]);
  });
});
