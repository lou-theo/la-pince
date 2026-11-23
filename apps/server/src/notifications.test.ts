import {
  type GroupId,
  groupIdSchema,
  MAX_PUSH_NOTICES,
  memberIdSchema,
  pushMessageSchema,
  type RevisionId,
  revisionIdSchema,
  type SubscribeRequest,
} from '@la-pince/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestHarness } from 'wrangler';

import type { Env } from './index.ts';
import {
  deleteSubscription,
  deliverBatch,
  MAX_GROUP_SUBSCRIPTIONS,
  MAX_PUSH_BYTES,
  type NotificationMessage,
  type Notifier,
  notifierOf,
  queueNotifications,
  queueTest,
  saveSubscription,
  type Send,
  sendBatches,
} from './notifications.ts';
import { applyBatch } from './store.ts';
import { generateVapidKeys, toBase64Url } from './vapid.ts';

// The statements run against the local D1 of workerd, called from the tests; the queue and the push services are played by the tests.
const server = createTestHarness({ workers: [{ configPath: './wrangler.jsonc' }] });
let db: D1Database;
const vapid = await generateVapidKeys();

beforeAll(async () => {
  await server.listen();
  await server.getWorker().applyD1Migrations('DB');
  db = (await server.getWorker<Env>().getEnv()).DB;
});

afterAll(async () => {
  await server.close();
});

let groups = 0;
const newGroup = async (members: readonly string[] = ['lea', 'max', 'tom']): Promise<GroupId> => {
  groups += 1;
  const id = groupIdSchema.parse(`notif${String(groups)}`);
  await db.batch([
    db.prepare('INSERT INTO groups (id, token_hash, title) VALUES (?, ?, ?)').bind(id, `hash-${id}`, 'Trip'),
    ...members.map((member, position) =>
      db.prepare('INSERT INTO members (group_id, id, name, position) VALUES (?, ?, ?, ?)').bind(id, member, member.toUpperCase(), position),
    ),
  ]);
  return id;
};

// A phone's subscription: a real P-256 key, so that the encryption runs as it does for a real phone, which the tests keep to decrypt what is sent.
let phones = 0;
const phoneKeys = new Map<string, CryptoKeyPair>();
const phone = async (member: string): Promise<SubscribeRequest> => {
  phones += 1;
  const endpoint = `https://fcm.googleapis.com/fcm/send/phone${String(phones)}`;
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  phoneKeys.set(endpoint, pair);
  const p256dh = toBase64Url(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer));
  const auth = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  return {
    member: memberIdSchema.parse(member),
    subscription: { endpoint, keys: { p256dh, auth } },
  };
};

const fromBase64Url = (text: string) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));

// What the phone does with a body (RFC 8291, one record of RFC 8188): the plaintext, delimiter and padding of the record removed.
const decrypt = async (body: Uint8Array, endpoint: string, auth: string): Promise<Uint8Array> => {
  const pair = phoneKeys.get(endpoint);
  if (pair === undefined) {
    throw new Error(`no phone behind ${endpoint}`);
  }
  const hmac = async (key: Uint8Array, data: Uint8Array) => {
    const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data));
  };
  const concat = (...parts: Uint8Array[]) => {
    const all = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    parts.reduce((offset, part) => (all.set(part, offset), offset + part.byteLength), 0);
    return all;
  };
  const text = (value: string) => new TextEncoder().encode(value);
  const salt = body.slice(0, 16);
  const serverKey = body.slice(21, 86);
  const phonePublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const serverPublic = await crypto.subtle.importKey('raw', serverKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // Web Crypto names the field `public`, which the Workers types spell `$public`: a variable rather than a literal passes the type check.
  const ecdh = { name: 'ECDH', public: serverPublic };
  const secret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, pair.privateKey, 256));
  const ikm = (
    await hmac(await hmac(fromBase64Url(auth), secret), concat(text('WebPush: info\0'), phonePublic, serverKey, new Uint8Array([1])))
  ).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(text('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(text('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(86)));
  return padded.slice(0, padded.lastIndexOf(2));
};

const subscribe = async (groupId: GroupId, ...members: string[]): Promise<SubscribeRequest[]> => {
  const requests = await Promise.all(members.map(phone));
  for (const request of requests) {
    expect(await saveSubscription(db, groupId, request)).toBe('saved');
  }
  return requests;
};

const countSubscriptions = async (groupId: GroupId): Promise<number> =>
  (await db.prepare('SELECT COUNT(*) AS count FROM subscriptions WHERE group_id = ?').bind(groupId).first<{ count: number }>())?.count ?? 0;

// The queue, played by the test: what the producer sent, batch by batch.
const fakeQueue = () => {
  const batches: NotificationMessage[][] = [];
  const queue = {
    send: (body: NotificationMessage) => {
      batches.push([body]);
      return Promise.resolve();
    },
    sendBatch: (messages: Iterable<MessageSendRequest<NotificationMessage>>) => {
      batches.push([...messages].map((message) => message.body));
      return Promise.resolve();
    },
  } as unknown as Queue<NotificationMessage>;
  return { batches, notifier: { db, queue, publicKey: vapid.publicKey } satisfies Notifier };
};

let revisions = 0;
const write = async (
  groupId: GroupId,
  operations: readonly { id: string; title?: string; payer?: string; members?: readonly string[]; author?: string; deleted?: true }[],
): Promise<RevisionId[]> => {
  const batch = operations.map(({ id, title = 'Pizza', payer = 'max', members = ['lea', 'max'], author, deleted }) => {
    revisions += 1;
    const revisionId = revisionIdSchema.parse(`nrev${String(revisions)}`);
    const raw = {
      id,
      revisionId,
      title,
      date: '2026-11-19',
      ...(author === undefined ? {} : { author }),
      ...(deleted === true
        ? { deleted }
        : { entry: { version: 1, kind: 'expense', payer, total: 2500, lines: members.map((member) => ({ member, weight: 1 })) } }),
    };
    return { revisionId, raw };
  });
  const results = await applyBatch(db, groupId, batch);
  expect(results.every((result) => result.status === 'written')).toBe(true);
  return batch.map((item) => item.revisionId);
};

const recipients = (batches: readonly NotificationMessage[][]) =>
  batches.flat().map((message) => `${message.member} ${message.endpoint.split('/').at(-1) ?? ''}`);

describe('notifierOf', () => {
  const queue = {} as Queue<NotificationMessage>;

  it('needs the queue and both keys', () => {
    expect(notifierOf({ DB: db, NOTIFICATIONS: queue, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' })).toStrictEqual({
      db,
      queue,
      publicKey: 'pub',
    });
    expect(notifierOf({ DB: db, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' })).toBeUndefined();
    expect(notifierOf({ DB: db, NOTIFICATIONS: queue, VAPID_PRIVATE_KEY: 'priv' })).toBeUndefined();
    expect(notifierOf({ DB: db, NOTIFICATIONS: queue, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: 'priv' })).toBeUndefined();
    expect(notifierOf({ DB: db, NOTIFICATIONS: queue, VAPID_PUBLIC_KEY: 'pub' })).toBeUndefined();
    expect(notifierOf({ DB: db, NOTIFICATIONS: queue, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: '' })).toBeUndefined();
  });
});

describe('saveSubscription and deleteSubscription', () => {
  it('saves a phone as a member, moves it to the member it says it is now, and stops it', async () => {
    const groupId = await newGroup();
    const [lea] = await subscribe(groupId, 'lea');
    expect(lea).toBeDefined();
    if (lea === undefined) {
      return;
    }
    expect(await saveSubscription(db, groupId, { ...lea, member: memberIdSchema.parse('tom') })).toBe('saved');
    const rows = await db.prepare('SELECT member_id AS member FROM subscriptions WHERE group_id = ?').bind(groupId).all();
    expect(rows.results).toStrictEqual([{ member: 'tom' }]);
    const other = await newGroup();
    await subscribe(other, 'lea');
    await deleteSubscription(db, groupId, lea.subscription.endpoint);
    expect(await countSubscriptions(groupId)).toBe(0);
    expect(await countSubscriptions(other)).toBe(1);
  });

  it('refuses a member the group does not have', async () => {
    const groupId = await newGroup();
    expect(await saveSubscription(db, groupId, await phone('zoe'))).toBe('unknown_member');
    expect(await countSubscriptions(groupId)).toBe(0);
  });

  it(`keeps ${String(MAX_GROUP_SUBSCRIPTIONS)} subscriptions per group, a phone already there still moving`, async () => {
    const groupId = await newGroup();
    const requests = await Promise.all(Array.from({ length: MAX_GROUP_SUBSCRIPTIONS }, () => phone('lea')));
    await db.batch(
      requests.map(({ subscription }) =>
        db
          .prepare("INSERT INTO subscriptions (group_id, endpoint, member_id, p256dh, auth) VALUES (?, ?, 'lea', ?, ?)")
          .bind(groupId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth),
      ),
    );
    expect(await saveSubscription(db, groupId, await phone('max'))).toBe('full');
    expect(await saveSubscription(db, groupId, { ...(requests[0] ?? (await phone('lea'))), member: memberIdSchema.parse('max') })).toBe('saved');
    expect(await countSubscriptions(groupId)).toBe(MAX_GROUP_SUBSCRIPTIONS);
  });
});

describe('queueTest', () => {
  it('queues a test message to the phone named, and nothing for a phone the group does not have', async () => {
    const groupId = await newGroup();
    const [lea] = await subscribe(groupId, 'lea');
    const { batches, notifier } = fakeQueue();
    expect(await queueTest(notifier, groupId, lea?.subscription.endpoint ?? '', 'https://pince.example')).toBe(true);
    expect(await queueTest(notifier, groupId, 'https://fcm.googleapis.com/fcm/send/unknown', 'https://pince.example')).toBe(false);
    expect(batches).toStrictEqual([
      [{ ...lea?.subscription, groupId, member: 'lea', subject: 'https://pince.example', message: { type: 'test', groupId } }],
    ]);
  });
});

describe('queueNotifications', () => {
  it('queues one message to each phone of the members concerned, not to the author nor to the others', async () => {
    const groupId = await newGroup(['lea', 'max', 'tom', 'zoe']);
    await subscribe(groupId, 'lea', 'lea', 'max', 'tom');
    const { batches, notifier } = fakeQueue();
    const written = await write(groupId, [{ id: 'n1-pizza', payer: 'max', members: ['lea', 'max', 'zoe'], author: 'max' }]);
    expect(await queueNotifications(notifier, groupId, written, 'https://pince.example')).toBe(2);
    expect(batches).toHaveLength(1);
    expect(batches.flat().map((message) => message.member)).toStrictEqual(['lea', 'lea']);
    expect(batches[0]?.[0]?.message).toStrictEqual({
      type: 'operations',
      groupId,
      count: 1,
      notices: [{ kind: 'added', operationId: 'n1-pizza', title: 'Pizza', author: 'max', authorName: 'MAX' }],
    });
    expect(batches[0]?.[0]?.subject).toBe('https://pince.example');
  });

  it('tells about a change the members the version before concerned, read from the database', async () => {
    const groupId = await newGroup();
    await subscribe(groupId, 'lea', 'tom');
    await write(groupId, [{ id: 'n2-train', payer: 'max', members: ['lea'], author: 'max' }]);
    const { batches, notifier } = fakeQueue();
    const written = await write(groupId, [{ id: 'n2-train', title: 'Train', payer: 'max', members: ['tom'], author: 'max' }]);
    expect(await queueNotifications(notifier, groupId, written, 'https://pince.example')).toBe(2);
    expect(batches.flat().map((message) => [message.member, message.message])).toStrictEqual([
      [
        'lea',
        {
          type: 'operations',
          groupId,
          count: 1,
          notices: [{ kind: 'changed', operationId: 'n2-train', title: 'Train', author: 'max', authorName: 'MAX' }],
        },
      ],
      [
        'tom',
        {
          type: 'operations',
          groupId,
          count: 1,
          notices: [{ kind: 'changed', operationId: 'n2-train', title: 'Train', author: 'max', authorName: 'MAX' }],
        },
      ],
    ]);
  });

  it(`carries the first ${String(MAX_PUSH_NOTICES)} notices of a batch and their count`, async () => {
    const groupId = await newGroup();
    await subscribe(groupId, 'lea');
    const { batches, notifier } = fakeQueue();
    const written = await write(
      groupId,
      Array.from({ length: 7 }, (_, index) => ({ id: `n3-op${String(index)}`, author: 'max' })),
    );
    expect(await queueNotifications(notifier, groupId, written, 'https://pince.example')).toBe(1);
    const message = pushMessageSchema.parse(batches[0]?.[0]?.message);
    expect(message.type === 'operations' ? [message.count, message.notices.map((notice) => notice.operationId)] : []).toStrictEqual([
      7,
      ['n3-op0', 'n3-op1', 'n3-op2', 'n3-op3', 'n3-op4'],
    ]);
  });

  it('drops the last notices of a message over the size every push is padded to, keeping their count', async () => {
    const groupId = await newGroup();
    await subscribe(groupId, 'lea');
    // Control characters weigh six bytes each once in JSON: five such notices go past what one push carries.
    await db.prepare("UPDATE members SET name = ? WHERE group_id = ? AND id = 'max'").bind('\u0001'.repeat(50), groupId).run();
    const { batches, notifier } = fakeQueue();
    const ops = Array.from({ length: 5 }, (_, index) => ({
      id: `n7-${String(index)}-${'x'.repeat(58)}`,
      title: '\u0001'.repeat(100),
      author: 'max',
    }));
    expect(await queueNotifications(notifier, groupId, await write(groupId, ops), 'https://pince.example')).toBe(1);
    const message = pushMessageSchema.parse(batches[0]?.[0]?.message);
    expect(message.type === 'operations' ? [message.count, message.notices.length < 5] : []).toStrictEqual([5, true]);
    expect(new TextEncoder().encode(JSON.stringify(message)).byteLength).toBeLessThanOrEqual(MAX_PUSH_BYTES);
  });

  it('queues nothing for revisions without an author, nor for revisions it cannot find', async () => {
    const groupId = await newGroup();
    await subscribe(groupId, 'lea');
    const { batches, notifier } = fakeQueue();
    expect(await queueNotifications(notifier, groupId, await write(groupId, [{ id: 'n4-import' }]), 'https://pince.example')).toBe(0);
    expect(await queueNotifications(notifier, groupId, [revisionIdSchema.parse('nowhere')], 'https://pince.example')).toBe(0);
    expect(
      await queueNotifications(notifier, groupId, await write(groupId, [{ id: 'n4-own', members: ['max'], author: 'max' }]), 'https://pince.example'),
    ).toBe(0);
    expect(batches).toStrictEqual([]);
  });

  it('names an author the group no longer has by its id', async () => {
    const groupId = await newGroup();
    await subscribe(groupId, 'lea');
    const written = await write(groupId, [{ id: 'n5-ghost', author: 'tom' }]);
    await db.prepare("DELETE FROM members WHERE group_id = ? AND id = 'tom'").bind(groupId).run();
    const { batches, notifier } = fakeQueue();
    await queueNotifications(notifier, groupId, written, 'https://pince.example');
    const message = pushMessageSchema.parse(batches[0]?.[0]?.message);
    expect(message.type === 'operations' ? message.notices[0]?.authorName : undefined).toBe('tom');
  });

  // Decision 46 (h): past the 13 members of the largest group seen, and past one `sendBatch`.
  it('notifies a group of 40 members with 5 phones each, in batches of at most 100 messages', async () => {
    const members = Array.from({ length: 40 }, (_, index) => `m${String(index)}`);
    const groupId = await newGroup(members);
    const requests = await Promise.all(members.flatMap((member) => Array.from({ length: 5 }, () => phone(member))));
    await db.batch(
      requests.map(({ member, subscription }) =>
        db
          .prepare('INSERT INTO subscriptions (group_id, endpoint, member_id, p256dh, auth) VALUES (?, ?, ?, ?, ?)')
          .bind(groupId, subscription.endpoint, member, subscription.keys.p256dh, subscription.keys.auth),
      ),
    );
    const { batches, notifier } = fakeQueue();
    const written = await write(groupId, [{ id: 'n6-dinner', payer: 'm0', members, author: 'm0' }]);
    expect(await queueNotifications(notifier, groupId, written, 'https://pince.example')).toBe(195);
    expect(batches.map((batch) => batch.length)).toStrictEqual([100, 95]);
    expect(new Set(recipients(batches)).size).toBe(195);
    expect(batches.flat().some((message) => message.member === 'm0')).toBe(false);
  });
});

describe('sendBatches', () => {
  it('cuts the messages so that a batch stays under 200 KB, in order', () => {
    const notice = { kind: 'added' as const, operationId: 'op1', title: 'é'.repeat(100), author: 'max', authorName: 'Max' };
    const message = (index: number) =>
      ({
        endpoint: `https://fcm.googleapis.com/fcm/send/${String(index)}${'x'.repeat(900)}`,
        keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) },
        groupId: 'g1',
        member: 'lea',
        subject: 'https://pince.example',
        message: { type: 'operations', groupId: 'g1', count: 5, notices: Array.from({ length: 5 }, () => notice) },
      }) as NotificationMessage;
    const batches = sendBatches(Array.from({ length: 100 }, (_, index) => message(index)));
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().map((item) => item.endpoint)).toStrictEqual(Array.from({ length: 100 }, (_, index) => message(index).endpoint));
    for (const batch of batches) {
      expect(new TextEncoder().encode(batch.map((item) => JSON.stringify(item)).join('')).byteLength).toBeLessThanOrEqual(200_000);
    }
    expect(sendBatches([])).toStrictEqual([]);
  });
});

describe('deliverBatch', () => {
  // Silenced, and read by the tests that check the line a push leaves.
  const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  const env = () => ({ DB: db, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey });

  const queued = (body: unknown) => ({ id: 'm1', timestamp: new Date(), attempts: 1, body, ack: vi.fn(), retry: vi.fn() });
  const batchOf = (...messages: ReturnType<typeof queued>[]) =>
    ({ queue: 'la-pince-notifications', messages, ackAll: vi.fn(), retryAll: vi.fn() }) as unknown as MessageBatch;

  const messageFor = async (groupId: GroupId, member: string): Promise<NotificationMessage> => {
    const [request] = await subscribe(groupId, member);
    return {
      endpoint: request?.subscription.endpoint ?? '',
      keys: request?.subscription.keys ?? { p256dh: '', auth: '' },
      groupId,
      member: memberIdSchema.parse(member),
      subject: 'https://pince.example',
      message: { type: 'test', groupId },
    };
  };

  it('sends each message encrypted, signed for the push service by the instance, and acknowledges it', async () => {
    const groupId = await newGroup();
    const body = await messageFor(groupId, 'lea');
    const message = queued(body);
    const send = vi.fn<Send>(() => Promise.resolve(new Response(null, { status: 201 })));
    await deliverBatch(batchOf(message), env(), send);
    expect(message.ack).toHaveBeenCalledOnce();
    const [endpoint, init] = send.mock.calls[0] ?? [];
    expect(endpoint).toBe(body.endpoint);
    const headers = new Headers(init?.headers);
    expect([headers.get('content-encoding'), headers.get('ttl'), init?.method]).toStrictEqual(['aes128gcm', '86400', 'post']);
    // RFC 8292: a JWT for the push service's origin, signed by the instance's key, with the instance's address as contact.
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(headers.get('authorization') ?? '') ?? [];
    expect(key).toBe(vapid.publicKey);
    const [header = '', claims = '', signature = ''] = token?.split('.') ?? [];
    const decode = (part: string) => Uint8Array.from(atob(part.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(decode(claims)))).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'https://pince.example' });
    const publicKey = await crypto.subtle.importKey('raw', decode(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const signed = new TextEncoder().encode(`${header}.${claims}`);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, decode(signature), signed)).toBe(true);
    expect(logs).toHaveBeenCalledWith(JSON.stringify({ notification: 'sent', status: 201, group: groupId, member: 'lea', attempt: 1 }));
  });

  it('pads every message to the same size, within what the push service of Firefox on Android relays, and the phone reads it', async () => {
    const groupId = await newGroup();
    const body = await messageFor(groupId, 'lea');
    const operations = pushMessageSchema.parse({
      type: 'operations',
      groupId,
      count: 2,
      notices: [
        { kind: 'added', operationId: 'op1', title: 'Courses du samedi', author: 'lea', authorName: 'Léa' },
        { kind: 'changed', operationId: 'op2', title: 'Essence', author: 'max', authorName: 'Max' },
      ],
    });
    const send = vi.fn<Send>(() => Promise.resolve(new Response(null, { status: 201 })));
    await deliverBatch(batchOf(queued(body), queued({ ...body, message: operations })), env(), send);
    const bodies = send.mock.calls.map(([, init]) => init.body as Uint8Array);
    expect(bodies.map((sent) => sent.byteLength)).toStrictEqual([MAX_PUSH_BYTES + 103, MAX_PUSH_BYTES + 103]);
    const read = await Promise.all(
      bodies.map(async (sent) => JSON.parse(new TextDecoder().decode(await decrypt(sent, body.endpoint, body.keys.auth))) as unknown),
    );
    expect(read).toStrictEqual([body.message, operations]);
    // What autopush-rs relays to FCM for Firefox on Android, as read in its source (`message_size_check` against 4096 bytes): the body in base64
    // with its channel, encoding and report ids.
    for (const sent of bodies) {
      const base64 = btoa(String.fromCharCode(...sent))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');
      const relayed = JSON.stringify({ chid: crypto.randomUUID(), body: base64, con: 'aes128gcm', rid: crypto.randomUUID() });
      expect(relayed.length).toBeLessThanOrEqual(4096);
    }
  });

  it.each([404, 410])('forgets a phone in every group when its push service answers %i', async (status) => {
    const groupId = await newGroup();
    const body = await messageFor(groupId, 'lea');
    const other = await newGroup();
    await saveSubscription(db, other, { member: memberIdSchema.parse('max'), subscription: { endpoint: body.endpoint, keys: body.keys } });
    const kept = await subscribe(groupId, 'tom');
    const message = queued(body);
    await deliverBatch(batchOf(message), env(), () => Promise.resolve(new Response(null, { status })));
    expect(message.ack).toHaveBeenCalledOnce();
    expect([await countSubscriptions(groupId), await countSubscriptions(other)]).toStrictEqual([kept.length, 0]);
  });

  it.each([
    ['an answer of 429', () => Promise.resolve(new Response(null, { status: 429 }))],
    ['an answer of 503', () => Promise.resolve(new Response(null, { status: 503 }))],
    ['a push service out of reach', () => Promise.reject(new TypeError('Network connection lost.'))],
  ])('retries a message later on %s', async (_, send) => {
    const groupId = await newGroup();
    const message = queued(await messageFor(groupId, 'lea'));
    await deliverBatch(batchOf(message), env(), send);
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(await countSubscriptions(groupId)).toBe(1);
  });

  it('drops, without sending nor retrying, a message whose phone key is not a point of P-256', async () => {
    const groupId = await newGroup();
    const body = await messageFor(groupId, 'lea');
    const message = queued({ ...body, keys: { ...body.keys, p256dh: `B${'a'.repeat(86)}` } });
    const send = vi.fn<Send>(() => Promise.resolve(new Response(null, { status: 201 })));
    await deliverBatch(batchOf(message), env(), send);
    expect([message.ack.mock.calls.length, message.retry.mock.calls.length, send.mock.calls.length]).toStrictEqual([1, 0, 0]);
    expect(logs).toHaveBeenCalledWith(expect.stringContaining('"notification":"invalid"'));
  });

  it('drops a message the push service refuses for another reason, keeping the phone', async () => {
    const groupId = await newGroup();
    const message = queued(await messageFor(groupId, 'lea'));
    await deliverBatch(batchOf(message), env(), () => Promise.resolve(new Response(null, { status: 403 })));
    expect(message.ack).toHaveBeenCalledOnce();
    expect(await countSubscriptions(groupId)).toBe(1);
  });

  it('drops a message it cannot read, or that it has no keys to send, without sending', async () => {
    const groupId = await newGroup();
    const unreadable = queued({ endpoint: 'https://fcm.googleapis.com/fcm/send/x' });
    const keyless = queued(await messageFor(groupId, 'lea'));
    const send = vi.fn(() => Promise.resolve(new Response(null, { status: 201 })));
    await deliverBatch(batchOf(unreadable), env(), send);
    await deliverBatch(batchOf(keyless), { DB: db }, send);
    expect([unreadable.ack, keyless.ack].map((ack) => ack.mock.calls.length)).toStrictEqual([1, 1]);
    expect(send).not.toHaveBeenCalled();
    expect(logs).toHaveBeenCalledWith(JSON.stringify({ notification: 'invalid', attempt: 1 }));
  });
});
