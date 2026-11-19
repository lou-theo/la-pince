import { type ApiError, cursorSchema, groupResponseSchema } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

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
    expect((await createApiClient(server.fetch).fetchChanges(token, cursor(first?.seq ?? 0))).ok && second !== undefined).toBe(true);
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
