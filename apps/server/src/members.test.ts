import { type GroupId, groupIdSchema, memberIdSchema, newMemberSchema } from '@la-pince/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';

import type { Env } from './index.ts';
import { addMember, readMembers, updateMember } from './members.ts';

// The statements run against the local D1 of workerd, called from the tests: a concurrent request is played by a read taken before another edit.
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
  const id = groupIdSchema.parse(`members${String(groups)}`);
  await db.batch([
    db.prepare('INSERT INTO groups (id, token_hash, title) VALUES (?, ?, ?)').bind(id, `hash-${id}`, 'Trip'),
    db.prepare("INSERT INTO members (group_id, id, name, position) VALUES (?, 'alice', 'Alice', 0), (?, 'bob', 'Bob', 1)").bind(id, id),
  ]);
  return id;
};

const member = (id: string, name: string) => newMemberSchema.parse({ id, name });
const stored = async (groupId: GroupId) =>
  (await db.prepare('SELECT id, name, position FROM members WHERE group_id = ? ORDER BY position, id').bind(groupId).all()).results;

describe('readMembers', () => {
  it('reads the members ordered by id, and an empty list for a group without any', async () => {
    const groupId = await newGroup();
    expect((await readMembers(db, groupId)).members).toStrictEqual([
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob' },
    ]);
    expect(await readMembers(db, groupIdSchema.parse('no-such-group'))).toStrictEqual({ snapshot: '[]', members: [] });
  });
});

describe('addMember after a concurrent edit', () => {
  it('refuses the name another request took in between, on a fresh read', async () => {
    const groupId = await newGroup();
    const before = await readMembers(db, groupId);
    expect(await addMember(db, groupId, member('paul1', 'Paul'), before)).toBe('added');
    expect(await addMember(db, groupId, member('paul2', 'Paul'), before)).toBe('member_name_taken');
    expect((await stored(groupId)).map((row) => row.id)).toStrictEqual(['alice', 'bob', 'paul1']);
  });

  it('refuses the name a renaming took in between', async () => {
    const groupId = await newGroup();
    const before = await readMembers(db, groupId);
    expect(await updateMember(db, groupId, memberIdSchema.parse('bob'), { name: 'Paul' }, before)).toBe('updated');
    expect(await addMember(db, groupId, member('paul', 'paul'), before)).toBe('member_name_taken');
  });

  it('answers a replay when the same request was written in between', async () => {
    const groupId = await newGroup();
    const before = await readMembers(db, groupId);
    expect(await addMember(db, groupId, member('carol', 'Carol'), before)).toBe('added');
    expect(await addMember(db, groupId, member('carol', 'Carol'), before)).toBe('replayed');
    expect(await stored(groupId)).toHaveLength(3);
  });

  it('adds the member after another one added in between, each at its own position', async () => {
    const groupId = await newGroup();
    const before = await readMembers(db, groupId);
    expect(await addMember(db, groupId, member('carol', 'Carol'), before)).toBe('added');
    expect(await addMember(db, groupId, member('dan', 'Dan'), before)).toBe('added');
    expect(await stored(groupId)).toStrictEqual([
      { id: 'alice', name: 'Alice', position: 0 },
      { id: 'bob', name: 'Bob', position: 1 },
      { id: 'carol', name: 'Carol', position: 2 },
      { id: 'dan', name: 'Dan', position: 3 },
    ]);
  });

  it('refuses a member past the cap reached in between', async () => {
    const groupId = await newGroup();
    const before = await readMembers(db, groupId);
    await db.batch(
      Array.from({ length: 98 }, (_, index) =>
        db
          .prepare('INSERT INTO members (group_id, id, name, position) VALUES (?, ?, ?, ?)')
          .bind(groupId, `m${String(index)}`, `M ${String(index)}`, index + 2),
      ),
    );
    expect(await addMember(db, groupId, member('one-more', 'One more'), before)).toBe('too_many_members');
  });
});

describe('updateMember after a concurrent edit', () => {
  it('refuses the name another request took in between', async () => {
    const groupId = await newGroup();
    const before = await readMembers(db, groupId);
    expect(await addMember(db, groupId, member('paul', 'Paul'), before)).toBe('added');
    expect(await updateMember(db, groupId, memberIdSchema.parse('alice'), { name: 'PAUL' }, before)).toBe('member_name_taken');
    expect((await stored(groupId)).map((row) => row.name)).toStrictEqual(['Alice', 'Bob', 'Paul']);
  });

  it('writes the last of two renamings of the same member', async () => {
    const groupId = await newGroup();
    const before = await readMembers(db, groupId);
    expect(await updateMember(db, groupId, memberIdSchema.parse('alice'), { name: 'Alicia' }, before)).toBe('updated');
    expect(await updateMember(db, groupId, memberIdSchema.parse('alice'), { name: 'Ali' }, before)).toBe('updated');
    expect((await stored(groupId)).map((row) => row.name)).toStrictEqual(['Ali', 'Bob']);
  });

  it('keeps the fields left out, and answers member_not_found for a member of no group of the link', async () => {
    const groupId = await newGroup();
    const read = await readMembers(db, groupId);
    expect(await updateMember(db, groupId, memberIdSchema.parse('bob'), {}, read)).toBe('updated');
    expect(await updateMember(db, groupId, memberIdSchema.parse('zoe'), { name: 'Zoé' }, read)).toBe('member_not_found');
    expect((await stored(groupId)).map((row) => row.name)).toStrictEqual(['Alice', 'Bob']);
  });
});
