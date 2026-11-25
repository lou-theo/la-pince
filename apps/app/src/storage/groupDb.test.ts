import { type Change, cursorSchema, groupResponseSchema, memberIdSchema, operationSchema } from '@la-pince/core';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';

import { change } from '../testing/fake-server.ts';
import { type CompleteRead, type GroupCopy, openGroupDb } from './groupDb.ts';

const token = 'demo-token-of-the-database-tests-0123456';
const group = groupResponseSchema.parse({ title: 'Week-end', members: [{ id: 'm1', name: 'Alice' }] });
const titles = (copy: GroupCopy | undefined) =>
  copy === undefined ? undefined : [...copy.changes.values()].map((current) => [current.id, current.title]);

/** A read from `since` that brought `changes`, the window holding `before` until then; its cursor is the seq of its last change. */
function readOf(since: number, changes: Change[], before: Change[] = [], reset = false): CompleteRead {
  const last = changes.at(-1)?.seq ?? since;
  return {
    group,
    since: cursorSchema.parse(since),
    changes,
    cursor: cursorSchema.parse(last),
    known: new Map([...before, ...changes].map((current) => [current.id, current])),
    reset,
  };
}

async function databaseName(): Promise<string> {
  const [database] = await indexedDB.databases();
  if (database?.name === undefined) {
    throw new Error('no database');
  }
  return database.name;
}

describe('openGroupDb', () => {
  it('names the database after the SHA-256 of the token, never the token itself', async () => {
    await openGroupDb(token);
    const names = (await indexedDB.databases()).map((database) => database.name);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^la-pince-group-[0-9a-f]{64}$/);
    expect(names[0]).not.toContain(token);
  });

  it('keeps each group apart, and who I am in each', async () => {
    const a = await openGroupDb(token);
    const b = await openGroupDb('another-token-of-the-database-tests-012');
    await a.saveRead(readOf(0, [change({ id: 'x', date: '2026-11-01' })]));
    await a.saveCurrentMember(memberIdSchema.parse('m1'));
    expect(await b.loadCopy()).toBeUndefined();
    expect(await b.loadCurrentMember()).toBeUndefined();
    expect(await a.loadCurrentMember()).toBe('m1');
  });

  it('merges the read of a late window into a copy saved further by another, keeping the latest revision of each operation and the furthest cursor', async () => {
    const first = change({ id: 'a', date: '2026-11-01' });
    const renamed = change({ id: 'a', date: '2026-11-01', title: 'Renamed' });
    const other = change({ id: 'b', date: '2026-11-02' });
    const ahead = await openGroupDb(token);
    const late = await openGroupDb(token);
    await late.saveRead(readOf(0, [first]));
    await ahead.saveRead(readOf(first.seq, [renamed, other], [first]));
    // The late window read from its own cursor before the other window saved, and saw the rename only.
    const joined = groupResponseSchema.parse({ ...group, members: [...group.members, { id: 'm2', name: 'Bruno' }] });
    await ahead.saveRead({ ...readOf(other.seq, []), group: joined });
    const merged = await late.saveRead(readOf(first.seq, [renamed], [first]));
    // Title and members go with the furthest cursor, read later by the other window.
    expect(merged.group).toStrictEqual(joined);
    expect(titles(merged)).toStrictEqual([
      ['a', 'Renamed'],
      ['b', 'Opération b'],
    ]);
    expect(merged.cursor).toBe(other.seq);
    // An older revision never replaces a newer one, even from a first read saved late.
    await late.saveRead(readOf(0, [first]));
    expect(titles(await late.loadCopy())).toStrictEqual(titles(merged));
    expect((await late.loadCopy())?.cursor).toBe(other.seq);
  });

  it('writes the whole copy of the window when the stored one stops before the read started, an earlier save having failed', async () => {
    const a = change({ id: 'a', date: '2026-11-01' });
    const b = change({ id: 'b', date: '2026-11-02' });
    const c = change({ id: 'c', date: '2026-11-03' });
    const db = await openGroupDb(token);
    await db.saveRead(readOf(0, [a]));
    // The read that brought `b` was not saved; the next one starts after `b`.
    const copy = await db.saveRead(readOf(b.seq, [c], [a, b]));
    expect(titles(copy)).toStrictEqual([
      ['a', 'Opération a'],
      ['b', 'Opération b'],
      ['c', 'Opération c'],
    ]);
    expect(copy.cursor).toBe(c.seq);
  });

  it('replaces the whole copy after the server rebuilt its history, an operation it no longer has leaving the phone', async () => {
    const db = await openGroupDb(token);
    const before = [change({ id: 'a', date: '2026-11-01' }), change({ id: 'gone', date: '2026-11-01' })];
    await db.saveRead(readOf(0, before));
    const again = change({ id: 'a', date: '2026-11-01' });
    const copy = await db.saveRead(readOf(0, [again], [], true));
    expect(titles(copy)).toStrictEqual([['a', 'Opération a']]);
    expect(copy.cursor).toBe(again.seq);
  });

  it('replaces the copy another window saved from a history the server lost, instead of merging into it', async () => {
    const a = change({ id: 'a', date: '2026-11-01' });
    const lost = [change({ id: 'lost1', date: '2026-11-02' }), change({ id: 'lost2', date: '2026-11-02' })];
    // Written after the database was restored to `a`: they take the seqs the lost changes had, and one more.
    const written = lost.map((gone, index) => ({
      ...change({ id: `new${String(index)}`, date: '2026-11-03' }),
      seq: gone.seq,
      createdSeq: gone.seq,
    }));
    const next = change({ id: 'new2', date: '2026-11-03' });
    const db = await openGroupDb(token);
    await db.saveRead(readOf(0, [a]));
    // Another window read the lost changes before the restore and saved them.
    await db.saveRead(readOf(a.seq, lost, [a]));
    // This window, still at `a` whose revision the server kept, reads what was written since the restore.
    const copy = await db.saveRead(readOf(a.seq, [...written, next], [a]));
    expect([...copy.changes.keys()]).toStrictEqual(['a', 'new0', 'new1', 'new2']);
    expect(copy.cursor).toBe(next.seq);
  });

  it('replaces the copy too when the lost history wrote the same operation under the same seq, with another revision', async () => {
    const a = change({ id: 'a', date: '2026-11-01' });
    const lost = change({ id: 'x', date: '2026-11-02', title: 'Lost' });
    // Written again after the restore, as an import does: same operation, same seq, another revision and content.
    const rewritten = { ...change({ id: 'x', date: '2026-11-02', title: 'Rewritten' }), seq: lost.seq, createdSeq: lost.seq };
    const next = change({ id: 'y', date: '2026-11-03' });
    const db = await openGroupDb(token);
    await db.saveRead(readOf(0, [a]));
    await db.saveRead(readOf(a.seq, [lost], [a]));
    const copy = await db.saveRead(readOf(a.seq, [rewritten, next], [a]));
    expect(titles(copy)).toStrictEqual([
      ['a', 'Opération a'],
      ['x', 'Rewritten'],
      ['y', 'Opération y'],
    ]);
  });

  it('keeps the previous copy whole when a save fails halfway', async () => {
    const db = await openGroupDb(token);
    const a = change({ id: 'a', date: '2026-11-01' });
    await db.saveRead(readOf(0, [a]));
    // A function cannot be stored: the transaction fails after it cleared the copy and wrote `b`.
    const poisoned = { ...change({ id: 'c', date: '2026-11-03' }), title: () => 'x' } as unknown as Change;
    await expect(db.saveRead(readOf(0, [change({ id: 'b', date: '2026-11-02' }), poisoned], [], true))).rejects.toThrow();
    expect(titles(await db.loadCopy())).toStrictEqual([['a', 'Opération a']]);
  });

  it('drops a copy that no longer matches the schemas of the core, so that the next save writes a whole one', async () => {
    const db = await openGroupDb(token);
    const a = change({ id: 'a', date: '2026-11-01' });
    await db.saveRead(readOf(0, [a]));
    const raw = await openDB(await databaseName());
    await raw.put('operations', { id: 'old', title: 'An older format' });
    expect(await db.loadCopy()).toBeUndefined();
    expect(await raw.count('operations')).toBe(0);
    const b = change({ id: 'b', date: '2026-11-02' });
    await db.saveRead(readOf(0, [a, b]));
    await raw.put('meta', { group, cursor: -1, readAt: 0 }, 'read');
    expect(await db.loadCopy()).toBeUndefined();
    await raw.put('meta', 'not a member id!', 'currentMember');
    expect(await db.loadCurrentMember()).toBeUndefined();
  });

  it('loads a copy saved by a newer version of the app, dropping the field this version does not know rather than the copy', async () => {
    const db = await openGroupDb(token);
    await db.saveRead(readOf(0, [change({ id: 'a', date: '2026-11-01' })]));
    const raw = await openDB(await databaseName());
    const stored = (await raw.get('meta', 'read')) as { group: object };
    await raw.put('meta', { ...stored, group: { ...group, members: group.members.map((member) => ({ ...member, picture: 'x' })) } }, 'read');
    expect((await db.loadCopy())?.group).toStrictEqual(group);
    expect(await raw.count('operations')).toBe(1);
  });
});

describe('the outbox of a group', () => {
  const expense = (id: string, revisionId: string) =>
    operationSchema.parse({
      id,
      revisionId,
      title: 'Courses',
      date: '2026-11-05',
      entry: { version: 1, kind: 'expense', payer: 'm1', lines: [{ member: 'm1', amount: 500 }] },
    });

  it('keeps the revisions in the order entered across openings, removes the ones answered, and leaves the copy alone', async () => {
    const db = await openGroupDb(token);
    const keys = [await db.addToOutbox(expense('a', 'a-1')), await db.addToOutbox(expense('b', 'b-1')), await db.addToOutbox(expense('a', 'a-2'))];
    await db.saveRead(readOf(0, [change({ id: 'x', date: '2026-11-01' })], [], true));
    const reopened = await openGroupDb(token);
    expect((await reopened.loadOutbox()).map((entry) => entry.operation.revisionId)).toStrictEqual(['a-1', 'b-1', 'a-2']);
    await reopened.removeFromOutbox(keys.slice(0, 2));
    expect(await reopened.loadOutbox()).toStrictEqual([{ key: keys[2], operation: expense('a', 'a-2') }]);
    expect(reopened.name).toBe(await databaseName());
  });

  it('drops a revision that no longer matches the schemas of the core', async () => {
    const db = await openGroupDb(token);
    await db.addToOutbox(expense('a', 'a-1'));
    const raw = await openDB(await databaseName());
    await raw.add('outbox', { id: 'b', title: 'An older format' });
    await db.addToOutbox(expense('c', 'c-1'));
    expect((await db.loadOutbox()).map((entry) => entry.operation.revisionId)).toStrictEqual(['a-1', 'c-1']);
    expect(await raw.count('outbox')).toBe(2);
  });
});
