import { apiErrorSchema, changesResponseSchema, operationBatchResponseSchema } from '@la-pince/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';

import type { Env } from './index.ts';

// The routes that edit a group from the app, under the link's token, in workerd with a local D1 migrated from the committed migrations. Requests sent
// together here may still run one after the other: `members.test.ts` plays the race itself, by a read taken before a concurrent edit.
const ADMIN_TOKEN = 'admin-token-of-the-tests-0123456789';
const server = createTestHarness({
  workers: [{ configPath: './wrangler.jsonc', secrets: { ADMIN_TOKEN } }],
});

beforeAll(async () => {
  await server.listen();
  await server.getWorker().applyD1Migrations('DB');
});

afterAll(async () => {
  await server.close();
});

type Fetched = Awaited<ReturnType<typeof server.fetch>>;

const admin = (id: string, body: unknown) =>
  server.fetch(`/api/admin/groups/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }, body: JSON.stringify(body) });

// Each test works in its own groups, so that tests share the database without seeing each other.
let groups = 0;
const newGroup = async (members = ['alice', 'bob']) => {
  groups += 1;
  const id = `edit${String(groups)}`;
  const token = `${id}-token-${'x'.repeat(32)}`;
  const response = await admin(id, { title: 'Trip', token, members: members.map((member) => ({ id: member, name: member.toUpperCase() })) });
  expect(response.status).toBe(200);
  return { id, token };
};

const call = (token: string, path: string, method: string, body: unknown) =>
  server.fetch(`/api/groups/${token}${path}`, { method, body: typeof body === 'string' ? body : JSON.stringify(body) });
const renameGroup = (token: string, body: unknown) => call(token, '', 'PATCH', body);
const addMember = (token: string, body: unknown) => call(token, '/members', 'POST', body);
const editMember = (token: string, id: string, body: unknown) => call(token, `/members/${id}`, 'PATCH', body);

const errorOf = async (response: Fetched) => [response.status, apiErrorSchema.parse(await response.json()).error];
// The raw JSON, as the app's schema would drop a field the server should not send.
const groupOf = async (response: Fetched) => [response.status, await response.json()];
const read = async (token: string) => (await server.fetch(`/api/groups/${token}`)).json();
const names = async (token: string) => ((await read(token)) as { members: { name: string }[] }).members.map((member) => member.name);

const positions = async (groupId: string) => {
  const { DB } = await server.getWorker<Env>().getEnv();
  const rows = await DB.prepare('SELECT id, position FROM members WHERE group_id = ? ORDER BY id')
    .bind(groupId)
    .all<{ id: string; position: number }>();
  return Object.fromEntries(rows.results.map((row) => [row.id, row.position]));
};

describe('PATCH /api/groups/:token', () => {
  it('renames the group, without the spaces at the ends, and answers with the whole group', async () => {
    const { token } = await newGroup();
    const expected = {
      title: 'Week-end at the sea',
      members: [
        { id: 'alice', name: 'ALICE' },
        { id: 'bob', name: 'BOB' },
      ],
      photos: true,
    };
    expect(await groupOf(await renameGroup(token, { title: '  Week-end at the sea \n' }))).toStrictEqual([200, expected]);
    expect(await read(token)).toStrictEqual(expected);
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['an empty title', { title: ' ' }],
    ['a title over 100 characters', { title: 'a'.repeat(101) }],
    ['a line break inside the title', { title: 'Week\nend' }],
    ['an unknown field', { title: 'Trip', token: 'x' }],
  ])('refuses %s', async (_, body) => {
    const { token } = await newGroup();
    expect(await errorOf(await renameGroup(token, body))).toStrictEqual([400, 'invalid_request']);
    expect(await read(token)).toMatchObject({ title: 'Trip' });
  });

  it('answers group_not_found for an unknown link', async () => {
    expect(await errorOf(await renameGroup('z'.repeat(32), { title: 'Trip' }))).toStrictEqual([404, 'group_not_found']);
  });
});

describe('POST /api/groups/:token/members', () => {
  it('adds the member at the end of the list, under the id the phone drew, and answers with the whole group', async () => {
    const { id, token } = await newGroup(['bob', 'alice']);
    const expected = {
      title: 'Trip',
      members: [
        { id: 'bob', name: 'BOB' },
        { id: 'alice', name: 'ALICE' },
        { id: 'aaron', name: 'Aaron' },
      ],
      photos: true,
    };
    expect(await groupOf(await addMember(token, { id: 'aaron', name: ' Aaron ' }))).toStrictEqual([201, expected]);
    expect(await read(token)).toStrictEqual(expected);
    expect(await positions(id)).toStrictEqual({ aaron: 2, alice: 1, bob: 0 });
  });

  it('answers a replay with the group as it is, without a second member, even after the member was renamed in between', async () => {
    const { token } = await newGroup();
    expect((await addMember(token, { id: 'carol', name: 'Carol' })).status).toBe(201);
    expect((await editMember(token, 'carol', { name: 'Caroline' })).status).toBe(200);
    const [status, group] = await groupOf(await addMember(token, { id: 'carol', name: 'Carol' }));
    expect(status).toBe(200);
    expect(group).toStrictEqual(await read(token));
    expect(await names(token)).toStrictEqual(['ALICE', 'BOB', 'Caroline']);
  });

  it('adds the member once when the same request arrives twice at the same time', async () => {
    const { token } = await newGroup();
    const responses = await Promise.all([addMember(token, { id: 'dan', name: 'Dan' }), addMember(token, { id: 'dan', name: 'Dan' })]);
    expect(responses.map((response) => response.status).toSorted()).toStrictEqual([200, 201]);
    expect(await names(token)).toStrictEqual(['ALICE', 'BOB', 'Dan']);
  });

  it('gives members added at the same time distinct positions, in a stable order', async () => {
    const { id, token } = await newGroup();
    const added = ['m1', 'm2', 'm3', 'm4', 'm5'];
    const responses = await Promise.all(added.map((member) => addMember(token, { id: member, name: `Member ${member}` })));
    expect(responses.map((response) => response.status)).toStrictEqual([201, 201, 201, 201, 201]);
    const stored = await positions(id);
    expect(new Set(Object.values(stored)).size).toBe(added.length + 2);
    const order = ((await read(token)) as { members: { id: string }[] }).members.map((member) => member.id);
    expect(order.slice(0, 2)).toStrictEqual(['alice', 'bob']);
    expect(order.slice(2).toSorted()).toStrictEqual(added);
    expect(order.map((member) => stored[member])).toStrictEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(((await read(token)) as { members: { id: string }[] }).members.map((member) => member.id)).toStrictEqual(order);
  });

  it('refuses a member past 100, and still answers a replay of one already there', async () => {
    const { token } = await newGroup(Array.from({ length: 100 }, (_, index) => `full${String(index)}`));
    expect(await errorOf(await addMember(token, { id: 'one-more', name: 'One more' }))).toStrictEqual([409, 'too_many_members']);
    expect((await addMember(token, { id: 'full7', name: 'FULL7' })).status).toBe(200);
  });

  it('accepts an operation naming the new member, refused before', async () => {
    const { token } = await newGroup();
    const expense = (revisionId: string) => ({
      id: 'with-erin',
      revisionId,
      title: 'Groceries',
      date: '2026-11-25',
      entry: { version: 1, kind: 'expense', payer: 'erin', lines: [{ member: 'alice', amount: 1000 }] },
    });
    const send = async (revisionId: string) =>
      operationBatchResponseSchema.parse(await (await call(token, '/operations', 'POST', { operations: [expense(revisionId)] })).json()).results;
    expect(await send('r1')).toStrictEqual([{ revisionId: 'r1', status: 'rejected', reason: 'unknown_member' }]);
    await addMember(token, { id: 'erin', name: 'Erin' });
    expect((await send('r2')).map((result) => result.status)).toStrictEqual(['written']);
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['no id', { name: 'Frank' }],
    ['an id a link would encode', { id: 'fr/ank', name: 'Frank' }],
    ['an empty name', { id: 'frank', name: '  ' }],
    ['a name over 50 characters', { id: 'frank', name: 'a'.repeat(51) }],
    ['a control character in the name', { id: 'frank', name: 'Fr\u0007ank' }],
    ['an unknown field', { id: 'frank', name: 'Frank', position: 0 }],
  ])('refuses %s', async (_, body) => {
    const { token } = await newGroup();
    expect(await errorOf(await addMember(token, body))).toStrictEqual([400, 'invalid_request']);
    expect(await names(token)).toStrictEqual(['ALICE', 'BOB']);
  });

  it('answers group_not_found for an unknown link', async () => {
    expect(await errorOf(await addMember('z'.repeat(32), { id: 'frank', name: 'Frank' }))).toStrictEqual([404, 'group_not_found']);
  });
});

describe('PATCH /api/groups/:token/members/:id', () => {
  it('renames the member, without changing the order, the operations or the balances', async () => {
    const { token } = await newGroup(['alice', 'bob', 'carol']);
    await call(token, '/operations', 'POST', {
      operations: [
        {
          id: 'dinner',
          revisionId: 'dinner-r1',
          title: 'Dinner',
          date: '2026-11-25',
          entry: { version: 1, kind: 'expense', payer: 'bob', lines: [{ member: 'alice', amount: 1200 }] },
        },
      ],
    });
    const changes = async () => changesResponseSchema.parse(await (await server.fetch(`/api/groups/${token}/changes`)).json());
    const before = await changes();
    expect(await groupOf(await editMember(token, 'bob', { name: ' Bobby ' }))).toStrictEqual([
      200,
      {
        title: 'Trip',
        members: [
          { id: 'alice', name: 'ALICE' },
          { id: 'bob', name: 'Bobby' },
          { id: 'carol', name: 'CAROL' },
        ],
        photos: true,
      },
    ]);
    // Operations name members by id: the same changes, so the same balances.
    expect(await changes()).toStrictEqual(before);
  });

  it('keeps the last of two renamings', async () => {
    const { token } = await newGroup();
    await editMember(token, 'alice', { name: 'Alicia' });
    await editMember(token, 'alice', { name: 'Ali' });
    expect(await names(token)).toStrictEqual(['Ali', 'BOB']);
  });

  it('answers member_not_found for an unknown member, or one of another group', async () => {
    const { token } = await newGroup();
    const other = await newGroup(['zoe']);
    expect(await errorOf(await editMember(token, 'nobody', { name: 'X' }))).toStrictEqual([404, 'member_not_found']);
    expect(await errorOf(await editMember(token, 'zoe', { name: 'X' }))).toStrictEqual([404, 'member_not_found']);
    expect(await names(other.token)).toStrictEqual(['ZOE']);
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['nothing to change', {}],
    ['an empty name', { name: '' }],
    ['a control character in the name', { name: 'Al\nice' }],
    ['an unknown field', { name: 'Alice', id: 'bob' }],
  ])('refuses %s', async (_, body) => {
    const { token } = await newGroup();
    expect(await errorOf(await editMember(token, 'alice', body))).toStrictEqual([400, 'invalid_request']);
  });

  it('refuses a member id a link would encode, and answers group_not_found for an unknown link', async () => {
    const { token } = await newGroup();
    expect(await errorOf(await editMember(token, 'al%20ice', { name: 'Alice' }))).toStrictEqual([400, 'invalid_request']);
    expect(await errorOf(await editMember('z'.repeat(32), 'alice', { name: 'Alice' }))).toStrictEqual([404, 'group_not_found']);
  });
});

describe('a name already taken in the group', () => {
  it('refuses to add a member under the name of another, whatever the case, the accents typed or the spaces', async () => {
    const { token } = await newGroup(['paul', 'elodie']);
    await editMember(token, 'elodie', { name: 'Élodie' });
    expect(await errorOf(await addMember(token, { id: 'p2', name: ' paul ' }))).toStrictEqual([409, 'member_name_taken']);
    expect(await errorOf(await addMember(token, { id: 'e2', name: 'ÉLODIE' }))).toStrictEqual([409, 'member_name_taken']);
    expect(await names(token)).toStrictEqual(['PAUL', 'Élodie']);
  });

  it('refuses to rename a member to the name of another, and lets a member change the case of its own', async () => {
    const { token } = await newGroup(['paul', 'anna']);
    expect(await errorOf(await editMember(token, 'anna', { name: 'Paul' }))).toStrictEqual([409, 'member_name_taken']);
    expect((await editMember(token, 'paul', { name: 'Paul' })).status).toBe(200);
    expect(await names(token)).toStrictEqual(['Paul', 'ANNA']);
  });

  it('adds only one of two members added under the same name at the same time', async () => {
    const { token } = await newGroup();
    const responses = await Promise.all([addMember(token, { id: 'paul1', name: 'Paul' }), addMember(token, { id: 'paul2', name: 'Paul' })]);
    expect(responses.map((response) => response.status).toSorted()).toStrictEqual([201, 409]);
    expect(await names(token)).toStrictEqual(['ALICE', 'BOB', 'Paul']);
  });

  it('gives a name to only one member when an addition and a renaming take it at the same time', async () => {
    const { token } = await newGroup();
    const responses = await Promise.all([addMember(token, { id: 'paul', name: 'Paul' }), editMember(token, 'bob', { name: 'Paul' })]);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
    expect((await names(token)).filter((name) => name === 'Paul')).toHaveLength(1);
  });

  it('is not refused by the admin route', async () => {
    const { id, token } = await newGroup(['paul']);
    const response = await admin(id, { title: 'Trip', token, members: [{ id: 'paul2', name: 'PAUL' }] });
    expect(response.status).toBe(200);
    expect(await names(token)).toStrictEqual(['PAUL', 'PAUL']);
  });
});

describe('a re-import after editing in the app', () => {
  it('keeps a member added in the app at its position, and writes the import’s names and title over the app’s', async () => {
    const { id, token } = await newGroup();
    await addMember(token, { id: 'gus', name: 'Gus' });
    await editMember(token, 'alice', { name: 'Alicia' });
    await renameGroup(token, { title: 'Renamed in the app' });
    expect(
      (
        await admin(id, {
          title: 'Trip',
          token,
          members: [
            { id: 'alice', name: 'ALICE' },
            { id: 'bob', name: 'BOB' },
            { id: 'hal', name: 'HAL' },
          ],
        })
      ).status,
    ).toBe(200);
    expect(await read(token)).toStrictEqual({
      title: 'Trip',
      members: [
        { id: 'alice', name: 'ALICE' },
        { id: 'bob', name: 'BOB' },
        { id: 'gus', name: 'Gus' },
        { id: 'hal', name: 'HAL' },
      ],
      photos: true,
    });
    expect(await positions(id)).toStrictEqual({ alice: 0, bob: 1, gus: 2, hal: 3 });
  });
});
