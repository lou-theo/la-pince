import {
  type ApiError,
  type Change,
  cursorSchema,
  groupResponseSchema,
  memberIdSchema,
  operationBatchSchema,
  operationIdSchema,
  operationSchema,
  seqSchema,
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
      `/changes?since=${String(changes[1]?.seq)}&revision=${String(changes[1]?.revisionId)}`,
      `/changes?since=${String(changes[3]?.seq)}&revision=${String(changes[3]?.revisionId)}`,
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
    const last = changes[2];
    changes.push(change({ id: 'a', date: '2026-11-02', title: 'Renamed' }), change({ id: 'b', date: '2026-11-01', deleted: true }));
    await store.load();
    expect(server.calls.at(-1)).toBe(`/api/groups/${token}/changes?since=${String(last?.seq)}&revision=${String(last?.revisionId)}`);
    const state = store.getSnapshot();
    expect(state.status === 'ready' && [...state.changes.values()].map((current) => [current.id, current.title, 'deleted' in current])).toStrictEqual(
      [
        ['a', 'Renamed', false],
        ['b', 'Opération b', true],
        ['c', 'Opération c', false],
      ],
    );
  });

  it('reads everything again from 0 once when the server no longer knows its cursor, and gives up the second time', async () => {
    const changes = [change({ id: 'a', date: '2026-11-01' }), change({ id: 'gone', date: '2026-11-01' })];
    const { server, store } = watch(changes);
    await store.load();
    // The server's base restored from before `gone`: its history no longer holds it.
    const [gone] = changes.splice(1, 1);
    await store.load();
    expect(server.calls.slice(-2)).toStrictEqual([
      `/api/groups/${token}/changes?since=${String(gone?.seq)}&revision=${String(gone?.revisionId)}`,
      `/api/groups/${token}/changes?since=0`,
    ]);
    expect(ids(store.getSnapshot())).toStrictEqual(['a']);

    const always = watch(changes, {
      token: otherToken,
      answer: (url) => (url.includes('changes') ? Promise.resolve(json({ error: 'unknown_cursor' }, 409)) : undefined),
    });
    await always.store.load();
    expect(always.store.getSnapshot()).toStrictEqual({ status: 'error', error: 'unexpected' });
  });

  it('gives up, keeping the group shown, when the read from 0 meets a second restore on one of its next pages', async () => {
    const changes = ['a', 'b', 'gone'].map((id) => change({ id, date: '2026-11-01' }));
    const [, b, gone] = changes;
    let restoredAgain = false;
    const { server, store } = watch(changes, {
      pageSize: 2,
      // Past the first page of the read from 0, the server no longer knows `b`: restored once more meanwhile.
      answer: (url) =>
        restoredAgain && url.includes(`since=${String(b?.seq)}&`)
          ? Promise.resolve(json({ error: 'unknown_cursor' } satisfies ApiError, 409))
          : undefined,
    });
    await store.load();
    changes.splice(2, 1, change({ id: 'c', date: '2026-11-02' }));
    restoredAgain = true;
    await store.load();
    expect(server.calls.filter((url) => url.includes('changes')).slice(-3)).toStrictEqual([
      `/api/groups/${token}/changes?since=${String(gone?.seq)}&revision=${String(gone?.revisionId)}`,
      `/api/groups/${token}/changes?since=0`,
      `/api/groups/${token}/changes?since=${String(b?.seq)}&revision=${String(b?.revisionId)}`,
    ]);
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', readError: 'unexpected' });
    expect(ids(store.getSnapshot())).toStrictEqual(['a', 'b', 'gone']);
  });

  it('reads everything again when the seq of its cursor was given to another revision after a restore', async () => {
    const changes = [change({ id: 'a', date: '2026-11-01' }), change({ id: 'gone', date: '2026-11-01' })];
    const { store } = watch(changes);
    await store.load();
    // Restored from before `gone`, then a write from another phone took its seq again: asking what changed after that seq would miss `new`.
    const [gone] = changes.splice(1, 1);
    changes.push({ ...change({ id: 'new', date: '2026-11-02' }), seq: seqSchema.parse(gone?.seq), createdSeq: seqSchema.parse(gone?.seq) });
    await store.load();
    expect(ids(store.getSnapshot())).toStrictEqual(['a', 'new']);
  });

  it('reads everything again when its copy lacks the change at its cursor, which it could not name', async () => {
    const first = change({ id: 'a', date: '2026-11-01' });
    const db = await openGroupDb(otherToken);
    const behind = cursorSchema.parse(first.seq + 5);
    await db.saveRead({ group, since: cursorSchema.parse(0), changes: [first], cursor: behind, known: new Map([[first.id, first]]), reset: true });
    const { server, store } = watch([first], { token: otherToken });
    await store.load();
    expect(server.calls.at(-1)).toBe(`/api/groups/${otherToken}/changes?since=0`);
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', cursor: first.seq });
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
  function outboxWatch(
    changes: Change[],
    options: { token?: string; openDb?: () => Promise<GroupDb>; refuse?: (revisionId: string) => boolean } = {},
  ) {
    const link = options.token ?? token;
    const server = fakeServer({ token: link, group, changes });
    const batches: string[][] = [];
    const network: {
      up: boolean;
      inFlight: number;
      mostInFlight: number;
      failReads: boolean;
      // An answer to every batch instead of the server's, and a promise that holds back the answer to each read of the changes.
      postAnswer?: () => Response;
      readGate?: Promise<void>;
    } = { up: true, inFlight: 0, mostInFlight: 0, failReads: false };
    const fetchFn: Fetch = async (url, init) => {
      if (!network.up || (network.failReads && init?.method !== 'POST')) {
        return failed();
      }
      network.inFlight += 1;
      network.mostInFlight = Math.max(network.mostInFlight, network.inFlight);
      try {
        const gate = network.readGate;
        if (url.includes('/changes') && gate !== undefined) {
          // Answered as the server stands now, delivered once the gate opens.
          const answer = await server.fetch(url, init);
          await gate;
          return answer;
        }
        if (init?.method === 'POST' && typeof init.body === 'string') {
          const { operations } = operationBatchSchema.parse(JSON.parse(init.body));
          batches.push(operations.map((operation) => operation.revisionId));
          if (network.postAnswer !== undefined) {
            return network.postAnswer();
          }
          const refused = operations.filter((operation) => options.refuse?.(operation.revisionId) === true);
          if (refused.length > 0) {
            // The server writes the others and answers each revision in the order sent.
            const accepted = operations.filter((operation) => !refused.includes(operation));
            const written =
              accepted.length === 0 ? json({ results: [] }) : await server.fetch(url, { ...init, body: JSON.stringify({ operations: accepted }) });
            const { results } = (await written.json()) as { results: { revisionId: string }[] };
            return json({
              results: operations.map((operation) =>
                refused.includes(operation)
                  ? { revisionId: operation.revisionId, status: 'rejected', reason: 'unknown_member' }
                  : results.find((result) => result.revisionId === operation.revisionId),
              ),
            });
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
    const { store } = outboxWatch([change({ id: 'a', date: '2026-11-01' })], { refuse: () => true });
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
    // A duplicate not read back stays as well.
    await store.sync();
    expect(shown(store.getSnapshot())).toMatchObject({ outbox: ['new-1'] });
    network.failReads = false;
    await store.sync();
    expect(shown(store.getSnapshot())).toStrictEqual({ outbox: [], changes: ['new'] });
    expect(batches).toStrictEqual([['new-1'], ['new-1'], ['new-1']]);
    expect(changes).toHaveLength(1);
  });

  it('drops only the refused revisions of a batch at once, the others waiting for a read', async () => {
    const { store, network } = outboxWatch([], { refuse: (revisionId) => revisionId === 'b-1' });
    await store.load();
    network.up = false;
    for (const id of ['a', 'b', 'c']) {
      await store.enqueue(expense(id, `${id}-1`));
    }
    await store.sync();
    network.up = true;
    network.failReads = true;
    await store.sync();
    expect(shown(store.getSnapshot())).toMatchObject({ outbox: ['a-1', 'c-1'] });
    network.failReads = false;
    await store.sync();
    expect(shown(store.getSnapshot())).toStrictEqual({ outbox: [], changes: ['a', 'c'] });
  });

  it('keeps the outbox when the server fails or answers outside the contract', async () => {
    const { store, network, changes } = outboxWatch([]);
    await store.load();
    await store.enqueue(expense('new', 'new-1'));
    for (const answer of [() => json({ error: 'internal' }, 500), () => json({ results: [] })]) {
      network.postAnswer = answer;
      await store.sync();
      expect(shown(store.getSnapshot())).toStrictEqual({ outbox: ['new-1'], changes: [] });
    }
    delete network.postAnswer;
    await store.sync();
    expect(shown(store.getSnapshot())).toStrictEqual({ outbox: [], changes: ['new'] });
    expect(changes).toHaveLength(1);
  });

  it('reads again after sending when a read was already running, so that the operation stays on screen throughout', async () => {
    const { store, batches, network } = outboxWatch([]);
    await store.load();
    const states: GroupState[] = [];
    store.subscribe(() => states.push(store.getSnapshot()));
    let open: () => void = () => undefined;
    network.readGate = new Promise((resolve) => {
      open = resolve;
    });
    const reading = store.sync();
    // The read of the changes is on its way when the revision is entered.
    await vi.waitFor(() => {
      expect(network.inFlight).toBe(1);
    });
    await store.enqueue(expense('new', 'new-1'));
    await vi.waitFor(() => {
      expect(batches).toHaveLength(1);
    });
    delete network.readGate;
    open();
    await reading;
    await vi.waitFor(() => {
      expect(shown(store.getSnapshot())).toStrictEqual({ outbox: [], changes: ['new'] });
    });
    const queuedAt = states.findIndex((state) => shown(state) !== 'loading' && state.status === 'ready' && state.outbox.length > 0);
    for (const state of states.slice(queuedAt)) {
      expect(state.status === 'ready' && (state.changes.has(operationIdSchema.parse('new')) || state.outbox.length > 0)).toBe(true);
    }
  });

  it('sends a revision entered while a pass ends, without waiting for the next wake', async () => {
    const real = await openGroupDb(token);
    let loads = 0;
    const db: GroupDb = {
      ...real,
      async loadOutbox() {
        const queued = await real.loadOutbox();
        loads += 1;
        // The first read is the restore at opening, the second the start of the pass that sends `first`.
        if (loads === 3) {
          // Entered after the outbox was read for the last time in this pass.
          await store.enqueue(expense('late', 'late-1'));
        }
        return queued;
      },
    };
    const { store, batches } = outboxWatch([], { openDb: () => Promise.resolve(db) });
    await store.load();
    await store.enqueue(expense('first', 'first-1'));
    await vi.waitFor(() => {
      expect(batches).toStrictEqual([['first-1'], ['late-1']]);
    });
  });

  it('keeps an accepted revision until the copy that holds it is saved on the phone', async () => {
    const real = await openGroupDb(token);
    const unsaved: GroupDb = { ...real, saveRead: () => Promise.reject(new DOMException('full', 'QuotaExceededError')) };
    const first = outboxWatch([], { openDb: () => Promise.resolve(unsaved) });
    await first.store.load();
    await first.store.enqueue(expense('new', 'new-1'));
    await first.store.sync();
    expect(shown(first.store.getSnapshot())).toStrictEqual({ outbox: ['new-1'], changes: ['new'] });
    // What the app would open on without network: no copy, but the revision still queued.
    expect(await real.loadCopy()).toBeUndefined();
    expect((await real.loadOutbox()).map((entry) => entry.operation.revisionId)).toStrictEqual(['new-1']);
  });

  it('keeps on screen what another window sent, even when this window cannot read the server', async () => {
    const a = outboxWatch([]);
    const b = outboxWatch(a.changes);
    await Promise.all([a.store.load(), b.store.load()]);
    b.network.up = false;
    await b.store.enqueue(expense('from-b', 'from-b-1'));
    await a.store.sync();
    expect(shown(a.store.getSnapshot())).toStrictEqual({ outbox: [], changes: ['from-b'] });
    await b.store.sync();
    expect(shown(b.store.getSnapshot())).toStrictEqual({ outbox: [], changes: ['from-b'] });
  });

  it('lets one window at a time send, so that two windows never send the same revision twice', async () => {
    const lock = fakeLocks();
    Object.defineProperty(navigator, 'locks', { value: lock, configurable: true });
    try {
      const a = outboxWatch([]);
      const b = outboxWatch(a.changes);
      await Promise.all([a.store.load(), b.store.load()]);
      a.network.up = false;
      b.network.up = false;
      for (const index of [1, 2, 3]) {
        await (index === 2 ? b : a).store.enqueue(expense(`op-${String(index)}`, `rev-${String(index)}`));
      }
      a.network.up = true;
      b.network.up = true;
      await Promise.all([a.store.sync(), b.store.sync()]);
      expect([...a.batches, ...b.batches].flat().sort()).toStrictEqual(['rev-1', 'rev-2', 'rev-3']);
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
        return server.fetch(url, init);
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
    const expense = (revisionId: string) =>
      operationSchema.parse({
        id: revisionId,
        revisionId,
        title: 'Courses',
        date: '2026-11-05',
        entry: { version: 1, kind: 'expense', payer: 'm1', lines: [{ member: 'm1', amount: 500 }] },
      });
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
    await store.enqueue(expense('new-1'));
    // Tried at once, then after 1 s, 2 s and 4 s more.
    await vi.advanceTimersByTimeAsync(7_000);
    expect(posts.map((at) => at - started)).toStrictEqual([0, 1_000, 3_000, 7_000]);
    up = true;
    await vi.advanceTimersByTimeAsync(8_000);
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', outbox: [] });

    // In the background, neither the 30 s wake nor the event of a hidden page reads.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const hiddenReads = reads();
    await vi.advanceTimersByTimeAsync(30_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reads()).toBe(hiddenReads);
    Reflect.deleteProperty(document, 'visibilityState');

    // The wait starts again from 1 s after a success; stopping cancels the retry pending.
    up = false;
    const again = Date.now();
    posts.length = 0;
    await store.enqueue(expense('new-2'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(posts.map((at) => at - again)).toStrictEqual([0, 1_000]);
    stop();
    up = true;
    const before = server.calls.length;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.calls).toHaveLength(before);
    expect(posts).toHaveLength(2);
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
    expect(next.server.calls.at(-1)).toBe(`/api/groups/${token}/changes?since=${String(changes[0]?.seq)}&revision=${String(changes[0]?.revisionId)}`);
  });

  it('keeps the last complete read when the network fails in the middle of catching up', async () => {
    const changes = ['a', 'b'].map((id) => change({ id, date: '2026-11-01' }));
    await watch(changes).store.load();
    changes.push(...['c', 'd', 'e'].map((id) => change({ id, date: '2026-11-02' })));
    const cut = (url: string) => (url.includes(`since=${String(changes[3]?.seq)}&`) ? Promise.reject(new TypeError('Failed to fetch')) : undefined);
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
    await watch(changes).store.load();

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

describe('editing the group', () => {
  it('shows the group an edit answered and keeps it over a read started before, so that an expense on a new member goes through', async () => {
    const server = fakeServer({ token, group, changes: [] });
    // Holds the group fetched by the next read, as the server stood then, until the gate opens.
    let gate: Promise<void> | undefined;
    let open: () => void = () => undefined;
    const fetchFn: Fetch = (url, init) => {
      if (gate !== undefined && url === `/api/groups/${token}` && init?.method === undefined) {
        const held = gate;
        gate = undefined;
        const early = server.fetch(url, init);
        return held.then(() => early);
      }
      return server.fetch(url, init);
    };
    const client = createApiClient(fetchFn);
    const store = createGroupStore(client, token);
    await store.load();
    gate = new Promise((resolve) => {
      open = resolve;
    });
    const stale = store.load();
    // The read has fetched the group before the edit reaches the server.
    await vi.waitFor(() => {
      expect(gate).toBeUndefined();
    });

    const added = await client.addMember(token, { id: memberIdSchema.parse('m9'), name: 'Zoé' });
    if (!added.ok) {
      throw new Error(added.error);
    }
    store.applyGroup(added.value);
    const members = () => {
      const state = store.getSnapshot();
      return state.status === 'ready' ? state.group.members.map((member) => member.name) : [];
    };
    expect(members()).toStrictEqual(['Alice', 'Zoé']);
    const expense = operationSchema.parse({
      id: 'with-zoe',
      revisionId: 'with-zoe-1',
      title: 'Glaces',
      date: '2026-11-25',
      entry: { version: 1, kind: 'expense', payer: 'm9', lines: [{ member: 'm1', amount: 300 }] },
    });
    expect(await store.enqueue(expense)).toStrictEqual({ ok: true });

    // The read started before the edit ends with the group as it was: the edit's group stays.
    open();
    await stale;
    expect(members()).toStrictEqual(['Alice', 'Zoé']);
    await vi.waitFor(() => {
      const state = store.getSnapshot();
      expect(state.status === 'ready' && { outbox: state.outbox.length, changes: [...state.changes.keys()] }).toStrictEqual({
        outbox: 0,
        changes: ['with-zoe'],
      });
    });
    expect(members()).toStrictEqual(['Alice', 'Zoé']);
  });

  it('saves the group an edit answered over the one a read started before fetched, for a restart without network', async () => {
    const server = fakeServer({ token, group, changes: [] });
    let gate: Promise<void> | undefined;
    let open: () => void = () => undefined;
    let down = false;
    const fetchFn: Fetch = (url, init) => {
      const isGroup = url === `/api/groups/${token}` && init?.method === undefined;
      if (gate !== undefined && isGroup) {
        const held = gate;
        gate = undefined;
        const early = server.fetch(url, init);
        return held.then(() => early);
      }
      // The read that follows the edit finds no network: only the read started before saves.
      return down && isGroup ? Promise.reject(new TypeError('Failed to fetch')) : server.fetch(url, init);
    };
    const client = createApiClient(fetchFn);
    const store = createGroupStore(client, token);
    await store.load();
    gate = new Promise((resolve) => {
      open = resolve;
    });
    const stale = store.load();
    await vi.waitFor(() => {
      expect(gate).toBeUndefined();
    });
    const added = await client.addMember(token, { id: memberIdSchema.parse('m9'), name: 'Zoé' });
    if (!added.ok) {
      throw new Error(added.error);
    }
    down = true;
    store.applyGroup(added.value);
    open();
    await stale;
    await vi.waitFor(() => {
      expect(store.getSnapshot()).toMatchObject({ status: 'ready', readError: 'network' });
    });

    const restarted = createGroupStore(client, token);
    await restarted.load();
    const state = restarted.getSnapshot();
    expect(state.status === 'ready' && state.group.members.map((member) => member.name)).toStrictEqual(['Alice', 'Zoé']);
  });

  it('reads the group again after an edit, which brings what changed meanwhile', async () => {
    const { server, store } = watch([]);
    await store.load();
    const calls = server.calls.length;
    store.applyGroup(groupResponseSchema.parse({ title: 'Renamed', members: group.members }));
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', group: { title: 'Renamed' } });
    await vi.waitFor(() => {
      expect(server.calls.length).toBeGreaterThan(calls);
    });
    // The fake server still holds the old title: the read that follows shows it, the last read being what the server holds.
    await vi.waitFor(() => {
      expect(store.getSnapshot()).toMatchObject({ status: 'ready', group: { title: 'Week-end' } });
    });
  });
});
