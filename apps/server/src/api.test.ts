import {
  apiErrorSchema,
  changesQuerySchema,
  type ChangesResponse,
  changesResponseSchema,
  operationBatchResponseSchema,
  pageFollowsQuery,
} from '@la-pince/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';

import type { Env } from './index.ts';

// The Worker runs in workerd, the runtime of Cloudflare, with a local D1 migrated from the committed migrations.
const ADMIN_TOKEN = 'admin-token-of-the-tests-0123456789';
// Paths resolve from the package directory, where the tests run.
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

// Each test works in its own groups, so that tests share the database without seeing each other.
let groups = 0;
const newGroup = async (members = ['alice', 'bob']) => {
  groups += 1;
  const id = `group${String(groups)}`;
  const token = `${id}-token-${'x'.repeat(32)}`;
  const response = await admin(id, {
    title: `Trip ${String(groups)}`,
    token,
    members: members.map((member) => ({ id: member, name: member.toUpperCase() })),
  });
  expect(response.status).toBe(200);
  return { id, token };
};

const admin = (id: string, body: unknown, token = ADMIN_TOKEN) =>
  server.fetch(`/api/admin/groups/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

const expense = (id: string, revisionId: string, { total = 1000, payer = 'alice' } = {}) => ({
  id,
  revisionId,
  title: 'Groceries',
  date: '2026-11-16',
  entry: { version: 1, kind: 'expense', payer, lines: [{ member: 'bob', amount: total }] },
});

const send = async (token: string, operations: unknown[]) => {
  const response = await server.fetch(`/api/groups/${token}/operations`, { method: 'POST', body: JSON.stringify({ operations }) });
  expect(response.status).toBe(200);
  return operationBatchResponseSchema.parse(await response.json()).results;
};

const read = async (token: string, query: Record<string, string> = {}) => {
  const response = await server.fetch(`/api/groups/${token}/changes?${new URLSearchParams(query).toString()}`);
  expect(response.status).toBe(200);
  const page = changesResponseSchema.parse(await response.json());
  expect(pageFollowsQuery(changesQuerySchema.parse(query), page)).toBe(true);
  return page;
};

// Query of the next read after a page, as a phone sends it: the cursor and the revision received at it.
const after = (page: ChangesResponse, limit?: string) => ({
  since: String(page.cursor),
  revision: page.changes.at(-1)?.revisionId ?? '',
  ...(limit === undefined ? {} : { limit }),
});

const errorOf = async (response: Awaited<ReturnType<typeof server.fetch>>) => [response.status, apiErrorSchema.parse(await response.json()).error];

describe('PUT /api/admin/groups/:id', () => {
  it('refuses a missing or wrong admin token', async () => {
    const body = { title: 'Trip', token: 'y'.repeat(32), members: [{ id: 'alice', name: 'Alice' }] };
    expect(await errorOf(await admin('g', body, 'wrong'))).toStrictEqual([401, 'unauthorized']);
    expect(await errorOf(await server.fetch('/api/admin/groups/g', { method: 'PUT', body: JSON.stringify(body) }))).toStrictEqual([
      401,
      'unauthorized',
    ]);
  });

  it('refuses a body or an id it cannot read', async () => {
    expect(await errorOf(await admin('g', { title: 'Trip' }))).toStrictEqual([400, 'invalid_request']);
    expect(await errorOf(await admin('g!', { title: 'Trip', token: 'y'.repeat(32), members: [{ id: 'a', name: 'A' }] }))).toStrictEqual([
      400,
      'invalid_request',
    ]);
  });

  it('creates the group, then renames it and its members, adds new members at the end and keeps those left out', async () => {
    const { id, token } = await newGroup(['alice', 'bob']);
    const response = await admin(id, {
      title: 'Renamed',
      token,
      members: [
        { id: 'carol', name: 'Carol' },
        { id: 'alice', name: 'Alicia' },
      ],
    });
    expect(await response.json()).toStrictEqual({
      title: 'Renamed',
      members: [
        { id: 'alice', name: 'Alicia' },
        { id: 'bob', name: 'BOB' },
        { id: 'carol', name: 'Carol' },
      ],
    });
  });

  it('refuses the link token of another group', async () => {
    const { token } = await newGroup();
    const { id } = await newGroup();
    expect(await errorOf(await admin(id, { title: 'Trip', token, members: [{ id: 'alice', name: 'Alice' }] }))).toStrictEqual([409, 'token_in_use']);
  });

  it('keeps only a hash of the link token', async () => {
    const { id, token } = await newGroup();
    const env = await server.getWorker<Env>().getEnv();
    const row = await env.DB.prepare('SELECT token_hash FROM groups WHERE id = ?').bind(id).first<{ token_hash: string }>();
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.token_hash).not.toContain(token);
  });
});

describe('GET /api/groups/:token', () => {
  it('gives the title and the members of the group behind the link', async () => {
    const { token } = await newGroup(['alice', 'bob']);
    const response = await server.fetch(`/api/groups/${token}`);
    // The raw JSON, as the app's schema would drop a field the server should not send.
    expect(await response.json()).toStrictEqual({
      title: expect.stringMatching(/^Trip /) as unknown,
      members: [
        { id: 'alice', name: 'ALICE' },
        { id: 'bob', name: 'BOB' },
      ],
    });
  });

  it('answers group_not_found for an unknown link', async () => {
    expect(await errorOf(await server.fetch(`/api/groups/${'z'.repeat(32)}`))).toStrictEqual([404, 'group_not_found']);
  });
});

describe('POST /api/groups/:token/operations', () => {
  it('writes the revisions in the order sent and serves them as changes, each with its seq and the seq of its creation', async () => {
    const { token } = await newGroup();
    const results = await send(token, [expense('a1', 'a1-r1'), expense('a2', 'a2-r1')]);
    expect(results.map((result) => result.status)).toStrictEqual(['written', 'written']);
    const page = await read(token);
    expect(page.changes.map((change) => [change.id, change.seq, change.createdSeq])).toStrictEqual(
      results.map((result, index) => [
        `a${String(index + 1)}`,
        result.status === 'written' ? result.seq : 0,
        result.status === 'written' ? result.seq : 0,
      ]),
    );
    expect(page.changes[0]).toMatchObject(expense('a1', 'a1-r1'));
  });

  it('serves the last revision of a modified operation, keeping the seq of its creation', async () => {
    const { token } = await newGroup();
    const [created] = await send(token, [expense('b1', 'b1-r1'), expense('b2', 'b2-r1')]);
    const [modified] = await send(token, [expense('b1', 'b1-r2', { total: 2500 })]);
    const page = await read(token);
    expect(page.changes.map((change) => change.id)).toStrictEqual(['b2', 'b1']);
    expect(page.changes[1]).toMatchObject({
      revisionId: 'b1-r2',
      seq: modified?.status === 'written' ? modified.seq : 0,
      createdSeq: created?.status === 'written' ? created.seq : 0,
    });
  });

  it('serves the mark of a deleted operation, which a replay of an older revision does not bring back', async () => {
    const { token } = await newGroup();
    await send(token, [expense('c1', 'c1-r1'), { id: 'c1', revisionId: 'c1-r2', title: 'Groceries', date: '2026-11-16', deleted: true }]);
    expect((await read(token)).changes).toMatchObject([{ id: 'c1', deleted: true }]);
    expect(await send(token, [expense('c1', 'c1-r1')])).toStrictEqual([{ revisionId: 'c1-r1', status: 'duplicate' }]);
    expect((await read(token)).changes).toMatchObject([{ id: 'c1', deleted: true }]);
  });

  it('answers a resend as a duplicate, without a new revision, even after a newer one arrived', async () => {
    const { token } = await newGroup();
    await send(token, [expense('d1', 'd1-r1')]);
    await send(token, [expense('d1', 'd1-r2', { total: 3000 })]);
    const before = await read(token);
    expect(await send(token, [expense('d1', 'd1-r1')])).toStrictEqual([{ revisionId: 'd1-r1', status: 'duplicate' }]);
    expect(await read(token)).toStrictEqual(before);
  });

  it('writes a revision once when two requests send it at the same time', async () => {
    const { id, token } = await newGroup();
    const results = await Promise.all([send(token, [expense('k1', 'k1-r1')]), send(token, [expense('k1', 'k1-r1')])]);
    expect(
      results
        .flat()
        .map((result) => result.status)
        .toSorted(),
    ).toStrictEqual(['duplicate', 'written']);
    const env = await server.getWorker<Env>().getEnv();
    const row = await env.DB.prepare('SELECT count(*) AS count FROM revisions WHERE group_id = ?').bind(id).first<{ count: number }>();
    expect(row?.count).toBe(1);
  });

  it('refuses a revision id received with another content', async () => {
    const { token } = await newGroup();
    await send(token, [expense('e1', 'e1-r1')]);
    expect(await send(token, [expense('e1', 'e1-r1', { total: 1 })])).toStrictEqual([
      { revisionId: 'e1-r1', status: 'rejected', reason: 'revision_conflict' },
    ]);
    expect((await read(token)).changes).toMatchObject([{ entry: { lines: [{ amount: 1000 }] } }]);
  });

  it('rejects each faulty revision with its reason and applies the others', async () => {
    const { token } = await newGroup();
    const results = await send(token, [
      expense('f1', 'f1-r1'),
      expense('f2', 'f2-r1', { payer: 'mallory' }),
      { ...expense('f3', 'f3-r1'), entry: { version: 1, kind: 'expense', payer: 'alice', total: 5, lines: [{ member: 'bob', amount: 4 }] } },
      expense('f4', 'f4-r1'),
    ]);
    expect(results.map((result) => (result.status === 'rejected' ? result.reason : result.status))).toStrictEqual([
      'written',
      'unknown_member',
      'invalid_operation',
      'written',
    ]);
    expect((await read(token)).changes.map((change) => change.id)).toStrictEqual(['f1', 'f4']);
  });

  it('refuses an operation id or a revision id already used by another group', async () => {
    const first = await newGroup();
    const second = await newGroup();
    await send(first.token, [expense('g1', 'g1-r1')]);
    expect(await send(second.token, [expense('g1', 'g1-r2'), expense('g2', 'g1-r1')])).toStrictEqual([
      { revisionId: 'g1-r2', status: 'rejected', reason: 'operation_in_other_group' },
      { revisionId: 'g1-r1', status: 'rejected', reason: 'revision_conflict' },
    ]);
    expect((await read(second.token)).changes).toStrictEqual([]);
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['an empty batch', JSON.stringify({ operations: [] })],
    [
      'a batch over 50 revisions',
      JSON.stringify({ operations: Array.from({ length: 51 }, (_, index) => expense(`h${String(index)}`, `h${String(index)}-r1`)) }),
    ],
    ['a revision without a readable id', JSON.stringify({ operations: [{ id: 'h1' }] })],
  ])('refuses the whole batch for %s', async (_, body) => {
    const { token } = await newGroup();
    expect(await errorOf(await server.fetch(`/api/groups/${token}/operations`, { method: 'POST', body }))).toStrictEqual([400, 'invalid_request']);
  });

  it('answers group_not_found for an unknown link', async () => {
    const response = await server.fetch(`/api/groups/${'z'.repeat(32)}/operations`, {
      method: 'POST',
      body: JSON.stringify({ operations: [expense('i1', 'i1-r1')] }),
    });
    expect(await errorOf(response)).toStrictEqual([404, 'group_not_found']);
  });
});

describe('GET /api/groups/:token/changes', () => {
  it('pages the changes, the last page saying nothing more is waiting', async () => {
    const { token } = await newGroup();
    await send(
      token,
      Array.from({ length: 5 }, (_, index) => expense(`j${String(index)}`, `j${String(index)}-r1`)),
    );
    const first = await read(token, { limit: '2' });
    const second = await read(token, after(first, '2'));
    const third = await read(token, after(second, '2'));
    expect([first.hasMore, second.hasMore, third.hasMore]).toStrictEqual([true, true, false]);
    expect([...first.changes, ...second.changes, ...third.changes].map((change) => change.id)).toStrictEqual(['j0', 'j1', 'j2', 'j3', 'j4']);
    expect(await read(token, after(third))).toStrictEqual({ changes: [], cursor: third.cursor, hasMore: false });
  });

  const changesAt = (token: string, since: number, revision: string) =>
    server.fetch(`/api/groups/${token}/changes?${new URLSearchParams({ since: String(since), revision }).toString()}`);

  it('answers unknown_cursor for a cursor past the last change, or whose revision is not the group’s at that seq', async () => {
    const { token } = await newGroup();
    const other = await newGroup();
    await send(token, [expense('m1', 'm1-r1')]);
    await send(other.token, [expense('m2', 'm2-r1')]);
    const page = await read(token);
    expect(await errorOf(await changesAt(token, page.cursor + 1_000, 'm1-r1'))).toStrictEqual([409, 'unknown_cursor']);
    expect(await errorOf(await changesAt(token, page.cursor, 'm2-r1'))).toStrictEqual([409, 'unknown_cursor']);
    const theOther = await read(other.token);
    // The right seq and revision, but read through the link of another group.
    expect(await errorOf(await changesAt(token, theOther.cursor, 'm2-r1'))).toStrictEqual([409, 'unknown_cursor']);
  });

  it('answers unknown_cursor once the database is restored before the cursor, its seq gone or given to another revision', async () => {
    const { token } = await newGroup();
    await send(token, [expense('n1', 'n1-r1')]);
    const before = await read(token);
    await send(token, [expense('n2', 'n2-r1')]);
    const seen = await read(token, after(before));
    expect(seen.changes.map((change) => change.id)).toStrictEqual(['n2']);
    // What a restore to the point before `n2` leaves: the revision and the operation gone, the counter back, as SQLite keeps it in the database.
    const { DB } = await server.getWorker<Env>().getEnv();
    await DB.batch([
      DB.prepare('DELETE FROM operations WHERE id = ?').bind('n2'),
      DB.prepare('DELETE FROM revisions WHERE seq = ?').bind(seen.cursor),
      DB.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'revisions'").bind(seen.cursor - 1),
    ]);
    expect(await errorOf(await changesAt(token, seen.cursor, 'n2-r1'))).toStrictEqual([409, 'unknown_cursor']);
    expect(await send(token, [expense('n3', 'n3-r1')])).toStrictEqual([{ revisionId: 'n3-r1', status: 'written', seq: seen.cursor }]);
    expect(await errorOf(await changesAt(token, seen.cursor, 'n2-r1'))).toStrictEqual([409, 'unknown_cursor']);
    // A phone that read `n3` after the restore goes on reading.
    expect(await read(token, after(await read(token, after(before))))).toStrictEqual({ changes: [], cursor: seen.cursor, hasMore: false });
  });

  it('refuses a query it cannot read, and an unknown link', async () => {
    const { token } = await newGroup();
    expect(await errorOf(await server.fetch(`/api/groups/${token}/changes?since=1e3`))).toStrictEqual([400, 'invalid_request']);
    expect(await errorOf(await server.fetch(`/api/groups/${token}/changes?since=1`))).toStrictEqual([400, 'invalid_request']);
    expect(await errorOf(await server.fetch(`/api/groups/${'z'.repeat(32)}/changes`))).toStrictEqual([404, 'group_not_found']);
  });
});

// This server has no push keys: an instance that has not set notifications up. The routes with keys are tested in `api-notifications.test.ts`.
describe('notifications on an instance without push keys', () => {
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/phone1', keys: { p256dh: `B${'a'.repeat(86)}`, auth: 'b'.repeat(22) } };

  it('answers notifications_disabled to the key, a subscription and a test, and still writes the revisions', async () => {
    const { token } = await newGroup();
    expect(await errorOf(await server.fetch('/api/notifications/key'))).toStrictEqual([404, 'notifications_disabled']);
    const subscribe = await server.fetch(`/api/groups/${token}/subscription`, {
      method: 'PUT',
      body: JSON.stringify({ member: 'alice', subscription }),
    });
    expect(await errorOf(subscribe)).toStrictEqual([404, 'notifications_disabled']);
    const test = await server.fetch(`/api/groups/${token}/subscription/test`, {
      method: 'POST',
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    expect(await errorOf(test)).toStrictEqual([404, 'notifications_disabled']);
    expect((await send(token, [{ ...expense('nokeys1', 'nokeys1-r1'), author: 'alice' }])).map((result) => result.status)).toStrictEqual(['written']);
  });

  it('still stops a subscription', async () => {
    const { token } = await newGroup();
    const response = await server.fetch(`/api/groups/${token}/subscription`, {
      method: 'DELETE',
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    expect(response.status).toBe(204);
  });
});
