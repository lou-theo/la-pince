import {
  type ApiError,
  type Change,
  groupResponseSchema,
  memberIdSchema,
  operationBatchSchema,
  operationIdSchema,
  operationSchema,
} from '@la-pince/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type GroupDb, openGroupDb } from '../storage/groupDb.ts';
import { change, fakeServer, json } from '../testing/fake-server.ts';
import { createApiClient, type Fetch } from './client.ts';
import { createGroupStore, type GroupState } from './groupStore.ts';

const token = 'demo-token-of-the-store-tests-0123456789';
const otherToken = 'other-token-of-the-store-tests-01234567';
const group = groupResponseSchema.parse({ title: 'Week-end', members: [{ id: 'm1', name: 'Alice' }] });

interface WatchOptions {
  pageSize?: number;
  answer?: (url: string) => Promise<Response> | undefined;
  token?: string;
  openDb?: () => Promise<GroupDb>;
}

/** A store over a fake server; stores of the same token share the copy kept on the phone, as two visits or two windows do. */
function watch(changes: Change[], { token: link = token, openDb, ...options }: WatchOptions = {}) {
  const server = fakeServer({ token: link, group, changes, ...options });
  const store = createGroupStore(createApiClient(server.fetch), link, openDb);
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

    const always = watch(changes, {
      token: otherToken,
      answer: (url) => (url.includes('changes') ? Promise.resolve(json({ error: 'cursor_ahead' }, 409)) : undefined),
    });
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

describe('the outbox', () => {
  const expense = (id: string, revisionId: string, payer = 'm1', amount = 500) =>
    operationSchema.parse({
      id,
      revisionId,
      title: 'Courses',
      date: '2026-11-05',
      entry: { version: 1, kind: 'expense', payer, lines: [{ member: 'm1', amount }] },
    });
  const failed = () => Promise.reject(new TypeError('Failed to fetch'));

  /** A store whose server can be cut off, recording each batch it receives and the most requests it had to answer at once. */
  function outboxWatch(changes: Change[], options: { token?: string; openDb?: () => Promise<GroupDb>; refuse?: boolean } = {}) {
    const link = options.token ?? token;
    const server = fakeServer({ token: link, group, changes });
    const batches: string[][] = [];
    const network = { up: true, inFlight: 0, mostInFlight: 0, failReads: false };
    const fetchFn: Fetch = async (url, init) => {
      if (!network.up || (network.failReads && init?.method !== 'POST')) {
        return failed();
      }
      network.inFlight += 1;
      network.mostInFlight = Math.max(network.mostInFlight, network.inFlight);
      try {
        if (init?.method === 'POST' && typeof init.body === 'string') {
          const { operations } = operationBatchSchema.parse(JSON.parse(init.body));
          batches.push(operations.map((operation) => operation.revisionId));
          if (options.refuse === true) {
            const results = operations.map((operation) => ({ revisionId: operation.revisionId, status: 'rejected', reason: 'unknown_member' }));
            return json({ results });
          }
        }
        // An answer that takes a turn of the event loop, so that overlapping requests would show.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return await server.fetch(url, init);
      } finally {
        network.inFlight -= 1;
      }
    };
    const store = createGroupStore(createApiClient(fetchFn), link, options.openDb);
    return { store, batches, network, changes };
  }
  const shown = (state: GroupState) =>
    state.status === 'ready' ? { outbox: state.outbox.map((operation) => operation.revisionId), changes: [...state.changes.keys()] } : state.status;

  it('shows a queued revision at once, sends it, and lets it go once the server copy holds it', async () => {
    const { store, batches } = outboxWatch([]);
    await store.load();
    const queuing = store.enqueue(expense('new', 'new-1'));
    expect(await queuing).toStrictEqual({ ok: true });
    expect(shown(store.getSnapshot())).toStrictEqual({ outbox: ['new-1'], changes: [] });
    await vi.waitFor(() => {
      expect(shown(store.getSnapshot())).toStrictEqual({ outbox: [], changes: ['new'] });
    });
    expect(batches).toStrictEqual([['new-1']]);
  });

  it('keeps what was entered without network across a restart, then sends it when the server answers again', async () => {
    const first = outboxWatch([]);
    await first.store.load();
    first.network.up = false;
    await first.store.enqueue(expense('offline', 'offline-1'));
    await first.store.sync();
    expect(shown(first.store.getSnapshot())).toStrictEqual({ outbox: ['offline-1'], changes: [] });

    const restarted = outboxWatch(first.changes);
    restarted.network.up = false;
    await restarted.store.sync();
    expect(restarted.store.getSnapshot()).toMatchObject({ status: 'ready', readError: 'network' });
    expect(shown(restarted.store.getSnapshot())).toStrictEqual({ outbox: ['offline-1'], changes: [] });
    restarted.network.up = true;
    await restarted.store.sync();
    expect(shown(restarted.store.getSnapshot())).toStrictEqual({ outbox: [], changes: ['offline'] });
    expect(restarted.batches).toStrictEqual([['offline-1']]);
  });

  it('sends every revision in the order entered, those of one operation unmerged, by batches of 50, one request at a time', async () => {
    const { store, batches, network, changes } = outboxWatch([]);
    await store.load();
    network.up = false;
    const entered = Array.from({ length: 120 }, (_, index) => expense(`op-${String(index % 7)}`, `rev-${String(index)}`, 'm1', 100 + index));
    for (const operation of entered) {
      await store.enqueue(operation);
    }
    network.up = true;
    await store.sync();
    expect(batches.map((batch) => batch.length)).toStrictEqual([50, 50, 20]);
    expect(batches.flat()).toStrictEqual(entered.map((operation) => operation.revisionId));
    expect(network.mostInFlight).toBe(1);
    // The last revision of each operation, as entered, is the one the server keeps.
    const last = changes.filter((current) => current.id === 'op-1').at(-1);
    expect(last?.revisionId).toBe('rev-113');
    expect(shown(store.getSnapshot())).toMatchObject({ outbox: [] });
  });

  it('drops a refused revision without notice, the operation going back to the server copy', async () => {
    const { store } = outboxWatch([change({ id: 'a', date: '2026-11-01' })], { refuse: true });
    await store.load();
    await store.enqueue(expense('a', 'a-2', 'm1', 999));
    await store.sync();
    const state = store.getSnapshot();
    expect(shown(state)).toStrictEqual({ outbox: [], changes: ['a'] });
    expect(state.status === 'ready' && state.changes.get(operationIdSchema.parse('a'))?.title).toBe('Opération a');
  });

  it('keeps a revision written but not read back, and sends it again, the server answering it was a duplicate', async () => {
    const { store, batches, network, changes } = outboxWatch([]);
    await store.load();
    network.failReads = true;
    await store.enqueue(expense('new', 'new-1'));
    await store.sync();
    expect(shown(store.getSnapshot())).toMatchObject({ outbox: ['new-1'] });
    network.failReads = false;
    await store.sync();
    expect(shown(store.getSnapshot())).toStrictEqual({ outbox: [], changes: ['new'] });
    expect(batches).toStrictEqual([['new-1'], ['new-1']]);
    expect(changes).toHaveLength(1);
  });

  it('lets one window at a time send, so that two windows never send the same revision twice', async () => {
    const lock = fakeLocks();
    Object.defineProperty(navigator, 'locks', { value: lock, configurable: true });
    try {
      const a = outboxWatch([]);
      const b = outboxWatch(a.changes);
      await Promise.all([a.store.load(), b.store.load()]);
      a.network.up = false;
      for (const index of [1, 2, 3]) {
        await a.store.enqueue(expense(`op-${String(index)}`, `rev-${String(index)}`));
      }
      a.network.up = true;
      await Promise.all([a.store.sync(), b.store.sync()]);
      expect([...a.batches, ...b.batches].flat()).toStrictEqual(['rev-1', 'rev-2', 'rev-3']);
      expect(lock.names).toContain(lock.names[0]);
      expect(lock.names.every((name) => /^la-pince-group-[0-9a-f]{64}-outbox$/.test(name))).toBe(true);
      await b.store.load();
      expect(shown(b.store.getSnapshot())).toStrictEqual({ outbox: [], changes: ['op-1', 'op-2', 'op-3'] });
    } finally {
      Reflect.deleteProperty(navigator, 'locks');
    }
  });

  it('keeps the outbox when the server rebuilt its history', async () => {
    const changes = [change({ id: 'a', date: '2026-11-01' }), change({ id: 'gone', date: '2026-11-01' })];
    const { store, network } = outboxWatch(changes);
    await store.load();
    network.up = false;
    await store.enqueue(expense('new', 'new-1'));
    changes.splice(1, 1);
    // The server's base restored from before `gone`, and still refusing writes.
    const server = fakeServer({ token, group, changes });
    const rebuilt = createGroupStore(
      createApiClient((url, init) => {
        if (init?.method === 'POST') {
          return failed();
        }
        return url.includes('changes') && !url.endsWith('?since=0') ? Promise.resolve(json({ error: 'cursor_ahead' }, 409)) : server.fetch(url, init);
      }),
      token,
    );
    await rebuilt.sync();
    expect(shown(rebuilt.getSnapshot())).toStrictEqual({ outbox: ['new-1'], changes: ['a'] });
  });

  it('refuses to queue a revision naming someone outside the group, or one the phone cannot store', async () => {
    const { store } = outboxWatch([]);
    await store.load();
    expect(await store.enqueue(expense('new', 'new-1', 'stranger'))).toStrictEqual({ ok: false, error: 'unknown_member' });
    const real = await openGroupDb(otherToken);
    const full: GroupDb = { ...real, addToOutbox: () => Promise.reject(new DOMException('full', 'QuotaExceededError')) };
    const noRoom = outboxWatch([], { token: otherToken, openDb: () => Promise.resolve(full) });
    await noRoom.store.load();
    expect(await noRoom.store.enqueue(expense('new', 'new-1'))).toStrictEqual({ ok: false, error: 'not_stored' });
    expect(shown(noRoom.store.getSnapshot())).toMatchObject({ outbox: [] });
  });

  it('queues in memory when the phone keeps nothing', async () => {
    const { store, batches } = outboxWatch([], { openDb: () => Promise.reject(new DOMException('denied', 'SecurityError')) });
    await store.load();
    await store.enqueue(expense('new', 'new-1'));
    await store.sync();
    expect(batches).toStrictEqual([['new-1']]);
    expect(shown(store.getSnapshot())).toStrictEqual({ outbox: [], changes: ['new'] });
  });
});

describe('waking the sync', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('syncs at start, on the way back of the network, back to the foreground and every 30 s, a failed send retried sooner, until stopped', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    let up = true;
    const server = fakeServer({ token, group, changes: [] });
    const posts: number[] = [];
    const reads = () => server.calls.filter((url) => url.includes('changes')).length;
    const store = createGroupStore(
      createApiClient((url, init) => {
        if (init?.method === 'POST') {
          posts.push(Date.now());
        }
        return up ? server.fetch(url, init) : Promise.reject(new TypeError('Failed to fetch'));
      }),
      token,
      // In memory: the simulated IndexedDB schedules its work on the timers faked here.
      () => Promise.reject(new Error('no storage')),
    );
    const stop = store.start();
    await vi.waitFor(() => {
      expect(reads()).toBe(1);
    });
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => {
      expect(reads()).toBe(2);
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => {
      expect(reads()).toBe(3);
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => {
      expect(reads()).toBe(4);
    });

    up = false;
    const started = Date.now();
    await store.enqueue(
      operationSchema.parse({
        id: 'new',
        revisionId: 'new-1',
        title: 'Courses',
        date: '2026-11-05',
        entry: { version: 1, kind: 'expense', payer: 'm1', lines: [{ member: 'm1', amount: 500 }] },
      }),
    );
    // Tried at once, then after 1 s, 2 s and 4 s more.
    await vi.advanceTimersByTimeAsync(7_000);
    expect(posts.map((at) => at - started)).toStrictEqual([0, 1_000, 3_000, 7_000]);
    up = true;
    await vi.advanceTimersByTimeAsync(8_000);
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', outbox: [] });

    stop();
    const before = server.calls.length;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.calls).toHaveLength(before);
  });
});

/** The Web Locks API as the browser gives it, reduced to exclusive locks granted in the order asked. */
function fakeLocks() {
  const tails = new Map<string, Promise<unknown>>();
  const names: string[] = [];
  return {
    names,
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      names.push(name);
      const run = (tails.get(name) ?? Promise.resolve()).then(callback);
      tails.set(
        name,
        run.catch(() => undefined),
      );
      return run;
    },
  };
}

describe('the copy kept on the phone', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const down = (url: string) => (url.startsWith('/api/') ? Promise.reject(new TypeError('Failed to fetch')) : undefined);

  it('opens without network on the last complete read, who I am included, and tells the read that failed', async () => {
    const changes = ['a', 'b'].map((id) => change({ id, date: '2026-11-01' }));
    const first = watch(changes);
    await first.store.load();
    first.store.chooseMember(memberIdSchema.parse('m1'));

    const offline = watch(changes, { answer: down });
    await offline.store.load();
    expect(offline.states).toHaveLength(2);
    expect(offline.store.getSnapshot()).toMatchObject({ status: 'ready', group, cursor: changes[1]?.seq, currentMember: 'm1', readError: 'network' });
    expect(ids(offline.store.getSnapshot())).toStrictEqual(['a', 'b']);
  });

  it('shows the copy first, then the group as read from the server, asking only what changed since the copy', async () => {
    const changes = [change({ id: 'a', date: '2026-11-01' })];
    await watch(changes).store.load();
    changes.push(change({ id: 'b', date: '2026-11-02' }));

    const next = watch(changes);
    await next.store.load();
    expect(next.states.map(ids)).toStrictEqual([['a'], ['a', 'b']]);
    expect(next.server.calls.at(-1)).toBe(`/api/groups/${token}/changes?since=${String(changes[0]?.seq)}`);
  });

  it('keeps the last complete read when the network fails in the middle of catching up', async () => {
    const changes = ['a', 'b'].map((id) => change({ id, date: '2026-11-01' }));
    await watch(changes).store.load();
    changes.push(...['c', 'd', 'e'].map((id) => change({ id, date: '2026-11-02' })));
    const cut = (url: string) => (url.endsWith(`since=${String(changes[3]?.seq)}`) ? Promise.reject(new TypeError('Failed to fetch')) : undefined);
    const interrupted = watch(changes, { pageSize: 2, answer: cut });
    await interrupted.store.load();
    expect(ids(interrupted.store.getSnapshot())).toStrictEqual(['a', 'b']);

    const offline = watch(changes, { answer: down });
    await offline.store.load();
    expect(offline.store.getSnapshot()).toMatchObject({ cursor: changes[1]?.seq });
    expect(ids(offline.store.getSnapshot())).toStrictEqual(['a', 'b']);
  });

  it('replaces the copy when the server is behind its cursor, an operation gone from the server leaving the phone too', async () => {
    const changes = [change({ id: 'a', date: '2026-11-01' }), change({ id: 'gone', date: '2026-11-01' })];
    await watch(changes).store.load();
    changes.splice(1, 1);
    const restored = (url: string) =>
      url.includes('changes') && !url.endsWith('?since=0') ? Promise.resolve(json({ error: 'cursor_ahead' } satisfies ApiError, 409)) : undefined;
    await watch(changes, { answer: restored }).store.load();

    const offline = watch(changes, { answer: down });
    await offline.store.load();
    expect(ids(offline.store.getSnapshot())).toStrictEqual(['a']);
    expect(offline.store.getSnapshot()).toMatchObject({ cursor: changes[0]?.seq });
  });

  it('works in memory when the phone keeps nothing, or when a save fails', async () => {
    const changes = [change({ id: 'a', date: '2026-11-01' })];
    const refused = watch(changes, { token: otherToken, openDb: () => Promise.reject(new DOMException('denied', 'SecurityError')) });
    await refused.store.load();
    refused.store.chooseMember(memberIdSchema.parse('m1'));
    expect(refused.store.getSnapshot()).toMatchObject({ status: 'ready', currentMember: 'm1' });
    expect(ids(refused.store.getSnapshot())).toStrictEqual(['a']);

    const real = await openGroupDb(token);
    const failing: GroupDb = { ...real, saveRead: () => Promise.reject(new DOMException('full', 'QuotaExceededError')) };
    const full = watch(changes, { openDb: () => Promise.resolve(failing) });
    await full.store.load();
    changes.push(change({ id: 'b', date: '2026-11-02' }));
    await full.store.load();
    expect(ids(full.store.getSnapshot())).toStrictEqual(['a', 'b']);
    expect(await real.loadCopy()).toBeUndefined();
  });

  it('asks once that the browser keep its storage, after the first save', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal('navigator', { storage: { persisted: () => Promise.resolve(false), persist } });
    const { store } = watch([]);
    await store.load();
    await store.load();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('saves the whole copy once a save succeeds after one that failed, so that nothing read meanwhile goes missing', async () => {
    const changes = [change({ id: 'a', date: '2026-11-01' })];
    const real = await openGroupDb(token);
    let failing = false;
    const flaky: GroupDb = {
      ...real,
      saveRead: (read) => (failing ? Promise.reject(new DOMException('full', 'QuotaExceededError')) : real.saveRead(read)),
    };
    const { store } = watch(changes, { openDb: () => Promise.resolve(flaky) });
    await store.load();
    changes.push(change({ id: 'b', date: '2026-11-02' }));
    failing = true;
    await store.load();
    changes.push(change({ id: 'c', date: '2026-11-03' }));
    failing = false;
    await store.load();
    expect(ids(store.getSnapshot())).toStrictEqual(['a', 'b', 'c']);

    const offline = watch(changes, { answer: down });
    await offline.store.load();
    expect(ids(offline.store.getSnapshot())).toStrictEqual(['a', 'b', 'c']);
  });

  it('keeps the copy a second window saved further when the first read of another window is saved late', async () => {
    const changes = [change({ id: 'a', date: '2026-11-01' })];
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const real = await openGroupDb(token);
    const late: GroupDb = { ...real, saveRead: (read) => gate.then(() => real.saveRead(read)) };
    const first = watch(changes, { openDb: () => Promise.resolve(late) });
    const firstLoad = first.store.load();
    await vi.waitFor(() => {
      expect(first.server.calls).toHaveLength(2);
    });
    changes.push(change({ id: 'b', date: '2026-11-02' }));
    const second = watch(changes);
    await second.store.load();
    open();
    await firstLoad;
    changes.push(change({ id: 'c', date: '2026-11-03' }));
    await second.store.load();
    expect(ids(second.store.getSnapshot())).toStrictEqual(['a', 'b', 'c']);
    expect(ids(first.store.getSnapshot())).toStrictEqual(['a', 'b']);
  });
});
