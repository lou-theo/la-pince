import { type ApiError, type Change, groupResponseSchema, operationSchema } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { change, fakeServer, json } from '../testing/fake-server.ts';
import { createApiClient } from './client.ts';
import { createGroupStore, type GroupState } from './groupStore.ts';

const token = 'demo-token-of-the-store-tests-0123456789';
const group = groupResponseSchema.parse({ title: 'Week-end', members: [{ id: 'm1', name: 'Alice' }] });

function watch(changes: Change[], options: { pageSize?: number; answer?: (url: string) => Promise<Response> | undefined } = {}) {
  const server = fakeServer({ token, group, changes, ...options });
  const store = createGroupStore(createApiClient(server.fetch), token);
  const states: GroupState[] = [];
  store.subscribe(() => states.push(store.getSnapshot()));
  return { server, store, states };
}
const ids = (state: GroupState) => (state.status === 'ready' ? [...state.changes.keys()] : state.status);

describe('createGroupStore', () => {
  it('reads every page before publishing the group, so that balances never see part of the changes', async () => {
    const changes = ['a', 'b', 'c', 'd', 'e'].map((id) => change({ id, date: '2026-11-01' }));
    const { server, store, states } = watch(changes, { pageSize: 2 });
    expect(store.getSnapshot()).toStrictEqual({ status: 'loading' });
    await store.load();
    expect(states.map(ids)).toStrictEqual([['a', 'b', 'c', 'd', 'e']]);
    expect(server.calls.map((url) => url.replace(`/api/groups/${token}`, ''))).toStrictEqual([
      '',
      `/changes?since=0`,
      `/changes?since=${String(changes[1]?.seq)}`,
      `/changes?since=${String(changes[3]?.seq)}`,
    ]);
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', group, cursor: changes[4]?.seq });
  });

  it('shares one read between calls made while it runs', async () => {
    const { server, store } = watch([change({ id: 'a', date: '2026-11-01' })]);
    await Promise.all([store.load(), store.load()]);
    expect(server.calls).toHaveLength(2);
  });

  it('reads only what changed since the last read, keeping the current revision of each operation', async () => {
    const changes = ['a', 'b', 'c'].map((id) => change({ id, date: '2026-11-01' }));
    const { server, store } = watch(changes);
    await store.load();
    const cursor = changes[2]?.seq;
    changes.push(change({ id: 'a', date: '2026-11-02', title: 'Renamed' }), change({ id: 'b', date: '2026-11-01', deleted: true }));
    await store.load();
    expect(server.calls.at(-1)).toBe(`/api/groups/${token}/changes?since=${String(cursor)}`);
    const state = store.getSnapshot();
    expect(state.status === 'ready' && [...state.changes.values()].map((current) => [current.id, current.title, 'deleted' in current])).toStrictEqual(
      [
        ['a', 'Renamed', false],
        ['b', 'Opération b', true],
        ['c', 'Opération c', false],
      ],
    );
  });

  it('reads everything again from 0 once when the server is behind its cursor, and gives up the second time', async () => {
    const changes = [change({ id: 'a', date: '2026-11-01' }), change({ id: 'gone', date: '2026-11-01' })];
    let ahead = 1;
    const cursorAhead = (url: string) =>
      !url.includes('changes') || url.endsWith('?since=0') || ahead-- <= 0
        ? undefined
        : Promise.resolve(json({ error: 'cursor_ahead' } satisfies ApiError, 409));
    const { server, store } = watch(changes, { answer: cursorAhead });
    await store.load();
    // The server's base restored from before `gone`: its history no longer holds it.
    changes.splice(1, 1);
    ahead = 1;
    await store.load();
    expect(server.calls.at(-1)).toBe(`/api/groups/${token}/changes?since=0`);
    expect(ids(store.getSnapshot())).toStrictEqual(['a']);

    const always = watch(changes, { answer: (url) => (url.includes('changes') ? Promise.resolve(json({ error: 'cursor_ahead' }, 409)) : undefined) });
    await always.store.load();
    expect(always.store.getSnapshot()).toStrictEqual({ status: 'error', error: 'unexpected' });
  });

  it('tells why a read failed, and reads again on retry', async () => {
    let down = true;
    const { store, states } = watch([change({ id: 'a', date: '2026-11-01' })], {
      answer: (url) => (down && url.includes('changes') ? Promise.reject(new TypeError('Failed to fetch')) : undefined),
    });
    await store.load();
    expect(store.getSnapshot()).toStrictEqual({ status: 'error', error: 'network' });
    down = false;
    await store.load();
    expect(states.map(ids)).toStrictEqual(['error', 'loading', ['a']]);

    const unknown = createGroupStore(createApiClient(fakeServer({ token, group }).fetch), 'another-token-of-the-store-tests-012345');
    await unknown.load();
    expect(unknown.getSnapshot()).toStrictEqual({ status: 'error', error: 'group_not_found' });
  });

  it('keeps a group already shown when a read fails, with the error beside it until a read succeeds', async () => {
    let down = false;
    const { store } = watch([change({ id: 'a', date: '2026-11-01' })], {
      answer: (url) => (down && url.includes('changes') ? Promise.reject(new TypeError('Failed to fetch')) : undefined),
    });
    await store.load();
    down = true;
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', readError: 'network' });
    expect(ids(store.getSnapshot())).toStrictEqual(['a']);
    down = false;
    await store.load();
    expect(store.getSnapshot()).not.toHaveProperty('readError');
  });
});

describe('sending a revision', () => {
  const expense = (id: string, revisionId: string, payer = 'm1') =>
    operationSchema.parse({
      id,
      revisionId,
      title: 'Courses',
      date: '2026-11-05',
      entry: { version: 1, kind: 'expense', payer, lines: [{ member: 'm1', amount: 500 }] },
    });

  it('writes it, then reads the group again to show it as the server wrote it', async () => {
    const { server, store } = watch([]);
    await store.load();
    expect(await store.send(expense('new', 'new-1'))).toStrictEqual({ ok: true, reread: true });
    expect(ids(store.getSnapshot())).toStrictEqual(['new']);
    expect(server.calls.slice(2).map((url) => url.replace(`/api/groups/${token}`, ''))).toStrictEqual(['/operations', '', '/changes?since=0']);
  });

  it('reads again after a read that started before the write, which may have missed it', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    // The first read of the changes is answered late, with the history as it was before the write.
    let firstRead = true;
    const { store } = watch([], {
      answer: (url) => {
        if (!firstRead || !url.includes('changes')) {
          return undefined;
        }
        firstRead = false;
        return gate.then(() => json({ changes: [], cursor: 0, hasMore: false }));
      },
    });
    const first = store.load();
    const sending = store.send(expense('new', 'new-1'));
    open();
    await first;
    expect(ids(store.getSnapshot())).toStrictEqual([]);
    expect(await sending).toStrictEqual({ ok: true, reread: true });
    expect(ids(store.getSnapshot())).toStrictEqual(['new']);
  });

  it('tells a revision written but not read back', async () => {
    let written = false;
    const { store } = watch([], {
      answer: (url) => {
        written ||= url.endsWith('/operations');
        return written && url.includes('changes') ? Promise.reject(new TypeError('Failed to fetch')) : undefined;
      },
    });
    await store.load();
    expect(await store.send(expense('new', 'new-1'))).toStrictEqual({ ok: true, reread: false });
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', readError: 'network' });
  });

  it('tells a refused revision or a failed request, without reading again', async () => {
    let down = false;
    const { server, store } = watch([], {
      answer: (url) => (down && url.endsWith('/operations') ? Promise.reject(new TypeError('Failed to fetch')) : undefined),
    });
    await store.load();
    expect(await store.send(expense('new', 'new-1', 'stranger'))).toStrictEqual({ ok: false, error: 'unknown_member' });
    down = true;
    expect(await store.send(expense('new', 'new-2'))).toStrictEqual({ ok: false, error: 'network' });
    expect(server.calls.filter((url) => url.includes('changes'))).toHaveLength(1);
  });
});
