import { type ApiError, type Change, cursorSchema, groupResponseSchema, operationSchema } from '@la-pince/core';
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
    expect(await answering(json({ error: 'cursor_ahead' } satisfies ApiError, 409)).fetchGroup(token)).toStrictEqual({
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

  it('reads a page of the changes since the cursor', async () => {
    const server = fakeServer({ token, group, changes, pageSize: 1 });
    const [first, second] = changes;
    expect(await createApiClient(server.fetch).fetchChanges(token, cursor(0))).toStrictEqual({
      ok: true,
      value: { changes: [first], cursor: first?.seq, hasMore: true },
    });
    expect(server.calls).toStrictEqual([`/api/groups/${token}/changes?since=0`]);
    expect(await createApiClient(server.fetch).fetchChanges(token, cursor(first?.seq ?? 0))).toStrictEqual({
      ok: true,
      value: { changes: [second], cursor: second?.seq, hasMore: false },
    });
  });

  it('passes on a cursor ahead of the server, and refuses a page that does not answer its query', async () => {
    expect(await answering(json({ error: 'cursor_ahead' } satisfies ApiError, 409)).fetchChanges(token, cursor(9))).toStrictEqual({
      ok: false,
      error: 'cursor_ahead',
    });
    // A change at or before the cursor asked: reading on from this page would skip or repeat changes.
    const stale = json({ changes, cursor: changes.at(-1)?.seq, hasMore: false });
    expect(await answering(stale).fetchChanges(token, cursor(changes.at(-1)?.seq ?? 0))).toStrictEqual({ ok: false, error: 'unexpected' });
    expect(await answering(json({ changes: [], cursor: 3, hasMore: false })).fetchChanges(token, cursor(2))).toStrictEqual({
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
    expect(await answering(json({ error: 'cursor_ahead' } satisfies ApiError, 409)).sendOperations(token, sent)).toStrictEqual({
      ok: false,
      error: 'unexpected',
    });
  });
});
