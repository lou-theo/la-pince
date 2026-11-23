import {
  type ApiError,
  type Change,
  cursorSchema,
  groupResponseSchema,
  operationSchema,
  revisionIdSchema,
  subscribeRequestSchema,
} from '@la-pince/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { change, fakeServer, json } from '../testing/fake-server.ts';
import { createApiClient } from './client.ts';

const token = 'demo-token-of-the-client-tests-0123456789';
const group = groupResponseSchema.parse({
  title: 'Week-end',
  members: [
    { id: 'm1', name: 'Alice' },
    { id: 'm2', name: 'Bruno' },
  ],
});
const answering = (response: Response | Error) =>
  createApiClient(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)));
const cursor = (value: number) => cursorSchema.parse(value);
const revision = (value: string) => revisionIdSchema.parse(value);

describe('fetchGroup', () => {
  it('reads the group of a token from the API, title and members in their order', async () => {
    const server = fakeServer({ token, group });
    expect(await createApiClient(server.fetch).fetchGroup(token)).toStrictEqual({ ok: true, value: group });
    expect(server.calls).toStrictEqual([`/api/groups/${token}`]);
  });

  it('tells an unknown link from a server out of reach and from an answer outside the contract', async () => {
    expect(await answering(json({ error: 'group_not_found' } satisfies ApiError, 404)).fetchGroup(token)).toStrictEqual({
      ok: false,
      error: 'group_not_found',
    });
    expect(await answering(new TypeError('Failed to fetch')).fetchGroup(token)).toStrictEqual({ ok: false, error: 'network' });
    expect(await answering(json({ title: 'Week-end', members: [] })).fetchGroup(token)).toStrictEqual({ ok: false, error: 'unexpected' });
    expect(await answering(new Response('<html>', { status: 200 })).fetchGroup(token)).toStrictEqual({ ok: false, error: 'unexpected' });
    expect(await answering(new Response('', { status: 502 })).fetchGroup(token)).toStrictEqual({ ok: false, error: 'unexpected' });
    expect(await answering(json({ error: 'invalid_request' } satisfies ApiError, 400)).fetchGroup(token)).toStrictEqual({
      ok: false,
      error: 'unexpected',
    });
    expect(await answering(json({ error: 'unknown_cursor' } satisfies ApiError, 409)).fetchGroup(token)).toStrictEqual({
      ok: false,
      error: 'unexpected',
    });
  });
});

describe('a request that never ends', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Like a browser's `fetch`, the fake fails the request or its body once the signal aborts it.
  const hanging = (stage: 'answer' | 'body') =>
    createApiClient(
      (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener('abort', () => {
                controller.error(new DOMException('Aborted', 'AbortError'));
              });
            },
          });
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
          if (stage === 'body') {
            resolve(new Response(stream, { status: 200 }));
          }
        }),
    );

  it('is given up after 30 s as a network failure, whether the answer or its body never comes', async () => {
    vi.useFakeTimers();
    for (const stage of ['answer', 'body'] as const) {
      const result = hanging(stage).fetchGroup(token);
      await vi.advanceTimersByTimeAsync(29_999);
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toStrictEqual({ ok: false, error: 'network' });
    }
  });
});

describe('fetchChanges', () => {
  const changes = [change({ id: 'a', date: '2026-11-01' }), change({ id: 'b', date: '2026-11-02' })];

  it('reads a page of the changes since the cursor, named with the revision received at it', async () => {
    const server = fakeServer({ token, group, changes, pageSize: 1 });
    const [first, second] = changes;
    expect(await createApiClient(server.fetch).fetchChanges(token, cursor(0), undefined)).toStrictEqual({
      ok: true,
      value: { changes: [first], cursor: first?.seq, hasMore: true },
    });
    const next = createApiClient(server.fetch).fetchChanges(token, cursor(first?.seq ?? 0), first?.revisionId);
    expect(await next).toStrictEqual({ ok: true, value: { changes: [second], cursor: second?.seq, hasMore: false } });
    expect(server.calls).toStrictEqual([
      `/api/groups/${token}/changes?since=0`,
      `/api/groups/${token}/changes?since=${String(first?.seq)}&revision=${String(first?.revisionId)}`,
    ]);
  });

  it('passes on a cursor the server no longer knows, and refuses a page that does not answer its query', async () => {
    const unknown = answering(json({ error: 'unknown_cursor' } satisfies ApiError, 409)).fetchChanges(token, cursor(9), revision('rev-9'));
    expect(await unknown).toStrictEqual({
      ok: false,
      error: 'unknown_cursor',
    });
    // A change at or before the cursor asked: reading on from this page would skip or repeat changes.
    const stale = json({ changes, cursor: changes.at(-1)?.seq, hasMore: false });
    const last = changes.at(-1);
    expect(await answering(stale).fetchChanges(token, cursor(last?.seq ?? 0), last?.revisionId)).toStrictEqual({ ok: false, error: 'unexpected' });
    expect(await answering(json({ changes: [], cursor: 3, hasMore: false })).fetchChanges(token, cursor(2), revision('rev-2'))).toStrictEqual({
      ok: false,
      error: 'unexpected',
    });
  });
});

describe('sendOperations', () => {
  const operation = (id: string, revisionId: string, payer = 'm1') =>
    operationSchema.parse({
      id,
      revisionId,
      title: 'Courses',
      date: '2026-11-05',
      entry: { version: 1, kind: 'expense', payer, lines: [{ member: 'm2', amount: 500 }] },
    });

  it('posts the revisions in one batch and gives the result of each', async () => {
    const changes: Change[] = [];
    const server = fakeServer({ token, group, changes });
    const client = createApiClient(server.fetch);
    const first = await client.sendOperations(token, [operation('a', 'a-1'), operation('b', 'b-1', 'stranger')]);
    expect(first).toMatchObject({
      ok: true,
      value: [
        { revisionId: 'a-1', status: 'written' },
        { revisionId: 'b-1', status: 'rejected', reason: 'unknown_member' },
      ],
    });
    expect(await client.sendOperations(token, [operation('a', 'a-1')])).toStrictEqual({
      ok: true,
      value: [{ revisionId: 'a-1', status: 'duplicate' }],
    });
    expect(server.calls).toStrictEqual([`/api/groups/${token}/operations`, `/api/groups/${token}/operations`]);
    expect(changes.map((written) => written.id)).toStrictEqual(['a']);
  });

  it('refuses an answer that does not give one result per revision sent, in order', async () => {
    const results = (...revisionIds: string[]) => json({ results: revisionIds.map((revisionId) => ({ revisionId, status: 'duplicate' })) });
    const sent = [operation('a', 'a-1'), operation('b', 'b-1')];
    expect(await answering(results('a-1', 'b-1')).sendOperations(token, sent)).toMatchObject({ ok: true });
    expect(await answering(results('b-1', 'a-1')).sendOperations(token, sent)).toStrictEqual({ ok: false, error: 'unexpected' });
    expect(await answering(results('a-1')).sendOperations(token, sent)).toStrictEqual({ ok: false, error: 'unexpected' });
    expect(await answering(new TypeError('Failed to fetch')).sendOperations(token, sent)).toStrictEqual({ ok: false, error: 'network' });
    expect(await answering(json({ error: 'group_not_found' } satisfies ApiError, 404)).sendOperations(token, sent)).toStrictEqual({
      ok: false,
      error: 'group_not_found',
    });
    expect(await answering(json({ error: 'unknown_cursor' } satisfies ApiError, 409)).sendOperations(token, sent)).toStrictEqual({
      ok: false,
      error: 'unexpected',
    });
  });
});

describe('notifications', () => {
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/phone1', keys: { p256dh: `B${'a'.repeat(86)}`, auth: 'b'.repeat(22) } };
  const request = subscribeRequestSchema.parse({ member: 'm1', subscription });
  const recording = (response: Response) => {
    const sent: { url: string; method: string | undefined; body: unknown }[] = [];
    const client = createApiClient((url, init) => {
      sent.push({ url, method: init?.method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      return Promise.resolve(response);
    });
    return { client, sent };
  };

  it('reads the public key, subscribes as a member and gives the group id, stops and asks for a test', async () => {
    const publicKey = `B${'k'.repeat(86)}`;
    expect(await answering(json({ publicKey })).fetchPushKey()).toStrictEqual({ ok: true, value: publicKey });

    const subscribing = recording(json({ groupId: 'week-end' }));
    expect(await subscribing.client.subscribe(token, request)).toStrictEqual({ ok: true, value: 'week-end' });
    expect(subscribing.sent).toStrictEqual([{ url: `/api/groups/${token}/subscription`, method: 'PUT', body: { member: 'm1', subscription } }]);

    const stopping = recording(new Response(null, { status: 204 }));
    expect(await stopping.client.unsubscribe(token, subscription.endpoint)).toStrictEqual({ ok: true, value: undefined });
    expect(stopping.sent).toStrictEqual([{ url: `/api/groups/${token}/subscription`, method: 'DELETE', body: { endpoint: subscription.endpoint } }]);

    const testing = recording(new Response(null, { status: 202 }));
    expect(await testing.client.sendTest(token, subscription.endpoint)).toStrictEqual({ ok: true, value: undefined });
    expect(testing.sent).toStrictEqual([
      { url: `/api/groups/${token}/subscription/test`, method: 'POST', body: { endpoint: subscription.endpoint } },
    ]);
  });

  it('passes on the errors of the notification routes, and refuses an answer outside the contract', async () => {
    for (const [error, status] of [
      ['notifications_disabled', 404],
      ['too_many_subscriptions', 409],
      ['invalid_request', 400],
      ['subscription_not_found', 404],
      ['group_not_found', 404],
    ] as const) {
      expect(await answering(json({ error } satisfies ApiError, status)).subscribe(token, request)).toStrictEqual({
        ok: false,
        error,
      });
    }
    expect(await answering(json({ error: 'unknown_cursor' } satisfies ApiError, 409)).sendTest(token, 'x')).toStrictEqual({
      ok: false,
      error: 'unexpected',
    });
    expect(await answering(json({ publicKey: 'short' })).fetchPushKey()).toStrictEqual({ ok: false, error: 'unexpected' });
    expect(await answering(json({ groupId: '' })).subscribe(token, request)).toStrictEqual({
      ok: false,
      error: 'unexpected',
    });
  });
});
