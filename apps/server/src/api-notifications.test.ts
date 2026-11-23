import { apiErrorSchema, pushKeyResponseSchema } from '@la-pince/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';

import type { Env } from './index.ts';
import { generateVapidKeys, toBase64Url } from './vapid.ts';

// The Worker runs in workerd with push keys and its local queue, producer and consumer, as on an instance that has set notifications up.
const ADMIN_TOKEN = 'admin-token-of-the-tests-0123456789';
const vapid = await generateVapidKeys();
const server = createTestHarness({
  workers: [{ configPath: './wrangler.jsonc', secrets: { ADMIN_TOKEN, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey } }],
});

beforeAll(async () => {
  await server.listen();
  await server.getWorker().applyD1Migrations('DB');
});

afterAll(async () => {
  await server.close();
});

let groups = 0;
const newGroup = async (members = ['alice', 'bob', 'carol']) => {
  groups += 1;
  const id = `push${String(groups)}`;
  const token = `${id}-token-${'x'.repeat(32)}`;
  const response = await server.fetch(`/api/admin/groups/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ title: 'Trip', token, members: members.map((member) => ({ id: member, name: member.toUpperCase() })) }),
  });
  expect(response.status).toBe(200);
  return { id, token };
};

const keys = { p256dh: `B${'a'.repeat(86)}`, auth: 'b'.repeat(22) };
const subscription = (name: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys });
const call = (token: string, path: string, method: string, body: unknown) =>
  server.fetch(`/api/groups/${token}/subscription${path}`, { method, body: JSON.stringify(body) });
const errorOf = async (response: Awaited<ReturnType<typeof server.fetch>>) => [response.status, apiErrorSchema.parse(await response.json()).error];

const storedSubscriptions = async (groupId: string) => {
  const { DB } = await server.getWorker<Env>().getEnv();
  return (await DB.prepare('SELECT endpoint, member_id AS member FROM subscriptions WHERE group_id = ? ORDER BY endpoint').bind(groupId).all())
    .results;
};

describe('GET /api/notifications/key', () => {
  it('gives the public key the phones subscribe with', async () => {
    const response = await server.fetch('/api/notifications/key');
    expect(response.status).toBe(200);
    expect(pushKeyResponseSchema.parse(await response.json())).toStrictEqual({ publicKey: vapid.publicKey });
  });
});

describe('PUT and DELETE /api/groups/:token/subscription', () => {
  it('saves a phone as a member, moves it when the member changes, and stops it', async () => {
    const { id, token } = await newGroup();
    const first = await call(token, '', 'PUT', { member: 'alice', subscription: subscription('a1') });
    expect([first.status, await first.json()]).toStrictEqual([200, { groupId: id }]);
    expect((await call(token, '', 'PUT', { member: 'bob', subscription: subscription('a1') })).status).toBe(200);
    expect(await storedSubscriptions(id)).toStrictEqual([{ endpoint: subscription('a1').endpoint, member: 'bob' }]);
    expect((await call(token, '', 'DELETE', { endpoint: subscription('a1').endpoint })).status).toBe(204);
    expect(await storedSubscriptions(id)).toStrictEqual([]);
  });

  it('refuses a body it cannot read, a member the group does not have, a push service it does not know, and an unknown link', async () => {
    const { id, token } = await newGroup();
    expect(await errorOf(await call(token, '', 'PUT', { member: 'alice' }))).toStrictEqual([400, 'invalid_request']);
    expect(await errorOf(await call(token, '', 'PUT', { member: 'zoe', subscription: subscription('z1') }))).toStrictEqual([400, 'invalid_request']);
    const elsewhere = { ...subscription('x'), endpoint: 'https://example.com/push' };
    expect(await errorOf(await call(token, '', 'PUT', { member: 'alice', subscription: elsewhere }))).toStrictEqual([400, 'invalid_request']);
    expect(await errorOf(await call('z'.repeat(32), '', 'PUT', { member: 'alice', subscription: subscription('u1') }))).toStrictEqual([
      404,
      'group_not_found',
    ]);
    expect(await errorOf(await call(token, '', 'DELETE', {}))).toStrictEqual([400, 'invalid_request']);
    expect(await errorOf(await call('z'.repeat(32), '', 'DELETE', { endpoint: subscription('u1').endpoint }))).toStrictEqual([
      404,
      'group_not_found',
    ]);
    expect(await storedSubscriptions(id)).toStrictEqual([]);
  });

  it('answers too_many_subscriptions once the group holds the most', async () => {
    const { id, token } = await newGroup();
    const { DB } = await server.getWorker<Env>().getEnv();
    await DB.batch(
      Array.from({ length: 200 }, (_, index) =>
        DB.prepare("INSERT INTO subscriptions (group_id, endpoint, member_id, p256dh, auth) VALUES (?, ?, 'alice', ?, ?)").bind(
          id,
          subscription(`full${String(index)}`).endpoint,
          keys.p256dh,
          keys.auth,
        ),
      ),
    );
    expect(await errorOf(await call(token, '', 'PUT', { member: 'bob', subscription: subscription('one-more') }))).toStrictEqual([
      409,
      'too_many_subscriptions',
    ]);
  });
});

describe('POST /api/groups/:token/subscription/test', () => {
  it('queues a test to a phone of the group, and answers subscription_not_found for another', async () => {
    const { token } = await newGroup();
    await call(token, '', 'PUT', { member: 'alice', subscription: subscription('t1') });
    expect((await call(token, '/test', 'POST', { endpoint: subscription('t1').endpoint })).status).toBe(202);
    expect(await errorOf(await call(token, '/test', 'POST', { endpoint: subscription('t2').endpoint }))).toStrictEqual([
      404,
      'subscription_not_found',
    ]);
    expect(await errorOf(await call(token, '/test', 'POST', {}))).toStrictEqual([400, 'invalid_request']);
    expect(await errorOf(await call('z'.repeat(32), '/test', 'POST', { endpoint: subscription('t1').endpoint }))).toStrictEqual([
      404,
      'group_not_found',
    ]);
  });
});

describe('notifications of written revisions', () => {
  // Consumer lines of this group in the logs of workerd, once `count` of them are there.
  const consumerLines = async (groupId: string, count: number) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const lines = server
        .getLogs()
        .flatMap((log) => {
          try {
            return [JSON.parse(log.message) as { notification: string; group?: string; member?: string; status?: number }];
          } catch {
            return [];
          }
        })
        .filter((line) => line.group === groupId);
      if (lines.length >= count) {
        return lines;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return [];
  };

  it('goes from the write through the queue to the consumer, for each phone of the members concerned but the author', async () => {
    const { id, token } = await newGroup();
    // Phones with a real key, whose push service refuses the connection, which the local runtime answers with a 500: the consumer encrypts,
    // sends to each once, then retries later, which the test does not wait for.
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const phoneKeys = {
      p256dh: toBase64Url(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)),
      auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    };
    const { DB } = await server.getWorker<Env>().getEnv();
    await DB.batch(
      ['alice', 'bob', 'bob', 'carol'].map((member, index) =>
        DB.prepare('INSERT INTO subscriptions (group_id, endpoint, member_id, p256dh, auth) VALUES (?, ?, ?, ?, ?)').bind(
          id,
          `https://127.0.0.1:1/${member}${String(index)}`,
          member,
          phoneKeys.p256dh,
          phoneKeys.auth,
        ),
      ),
    );
    const pizza = {
      id: 'p1',
      revisionId: 'p1-r1',
      title: 'Pizza',
      date: '2026-11-19',
      author: 'alice',
      entry: {
        version: 1,
        kind: 'expense',
        payer: 'alice',
        total: 2500,
        lines: [
          { member: 'alice', weight: 1 },
          { member: 'bob', weight: 1 },
        ],
      },
    };
    const response = await server.fetch(`/api/groups/${token}/operations`, { method: 'POST', body: JSON.stringify({ operations: [pizza] }) });
    expect(response.status).toBe(200);
    const lines = await consumerLines(id, 2);
    expect(lines.map((line) => [line.notification, line.member, line.status])).toStrictEqual([
      ['retry', 'bob', 500],
      ['retry', 'bob', 500],
    ]);
  });
});
