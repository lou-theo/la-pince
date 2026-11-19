import { cursorSchema, groupResponseSchema, memberIdSchema } from '@la-pince/core';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';

import { change } from '../testing/fake-server.ts';
import { type GroupCopy, openGroupDb } from './groupDb.ts';

const token = 'demo-token-of-the-database-tests-0123456';
const group = groupResponseSchema.parse({ title: 'Week-end', members: [{ id: 'm1', name: 'Alice' }] });
const cursor = (value: number) => cursorSchema.parse(value);
const titles = (copy: GroupCopy | undefined) =>
  copy === undefined ? undefined : [...copy.changes.values()].map((current) => [current.id, current.title]);

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
    await a.saveRead({ group, changes: [change({ id: 'x', date: '2026-11-01' })], cursor: cursor(1), fromStart: true });
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
    await late.saveRead({ group, changes: [first], cursor: cursor(first.seq), fromStart: true });
    await ahead.saveRead({ group, changes: [renamed, other], cursor: cursor(other.seq), fromStart: false });
    // The late window read from its own cursor before the other window saved, and saw the rename only.
    const merged = await late.saveRead({ group, changes: [renamed], cursor: cursor(renamed.seq), fromStart: false });
    expect(titles(merged)).toStrictEqual([
      ['a', 'Renamed'],
      ['b', 'Opération b'],
    ]);
    expect(merged.cursor).toBe(other.seq);
    // An older revision never replaces a newer one.
    await late.saveRead({ group, changes: [first], cursor: cursor(first.seq), fromStart: false });
    expect(titles(await late.loadCopy())).toStrictEqual(titles(merged));
  });

  it('replaces the whole copy with a read from 0', async () => {
    const db = await openGroupDb(token);
    const before = [change({ id: 'a', date: '2026-11-01' }), change({ id: 'gone', date: '2026-11-01' })];
    await db.saveRead({ group, changes: before, cursor: cursor(before[1]?.seq ?? 0), fromStart: true });
    const again = change({ id: 'a', date: '2026-11-01' });
    const copy = await db.saveRead({ group, changes: [again], cursor: cursor(again.seq), fromStart: true });
    expect(titles(copy)).toStrictEqual([['a', 'Opération a']]);
    expect(copy.cursor).toBe(again.seq);
  });

  it('gives no copy when what is stored no longer matches the schemas of the core', async () => {
    const db = await openGroupDb(token);
    await db.saveRead({ group, changes: [change({ id: 'a', date: '2026-11-01' })], cursor: cursor(1), fromStart: true });
    const raw = await openDB(await databaseName());
    await raw.put('operations', { id: 'a', title: 'An older format' });
    expect(await db.loadCopy()).toBeUndefined();
    await raw.clear('operations');
    await raw.put('meta', { group, cursor: -1, readAt: 0 }, 'read');
    expect(await db.loadCopy()).toBeUndefined();
    await raw.put('meta', 'not a member id!', 'currentMember');
    expect(await db.loadCurrentMember()).toBeUndefined();
  });
});
