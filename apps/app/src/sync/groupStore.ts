import {
  type Change,
  type Cursor,
  cursorSchema,
  type GroupResponse,
  MAX_BATCH_REVISIONS,
  type MemberId,
  type Operation,
  type OperationId,
  unknownMembers,
} from '@la-pince/core';

import { askPersistentStorage, type CompleteRead, type GroupDb, openGroupDb, type Queued } from '../storage/groupDb.ts';
import type { ApiClient, LoadError } from './client.ts';

export type GroupState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: LoadError }
  | {
      readonly status: 'ready';
      readonly group: GroupResponse;
      /** Current revision of each operation, deleted ones included, read up to a page with `hasMore: false`. */
      readonly changes: ReadonlyMap<OperationId, Change>;
      readonly cursor: Cursor;
      /** When the last complete read ended, in milliseconds since the epoch. */
      readonly readAt: number;
      /** Revisions entered on this phone and not yet acknowledged, in the order they were entered; the screens show them over `changes`. */
      readonly outbox: readonly Operation[];
      /** Who I am, as chosen on this phone; the screens check it is still a member. */
      readonly currentMember: MemberId | undefined;
      /** Why the last read failed, the group shown being the last one read in full; cleared by the next read that succeeds. */
      readonly readError?: LoadError;
    };

/** Why a revision was not queued: it names someone who is not a member of the group, or the phone could not store it. */
export type QueueError = 'unknown_member' | 'not_stored';
export type QueueResult = { readonly ok: true } | { readonly ok: false; readonly error: QueueError };

export interface GroupStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => GroupState;
  /**
   * Reads the group and every change since the last read; a call during a read waits for that read. The first call shows the copy kept on this
   * phone, if any, before asking the server.
   */
  readonly load: () => Promise<void>;
  /** Queues a revision on the phone, shows it at once over the server's copy, then tries to send the outbox. */
  readonly enqueue: (operation: Operation) => Promise<QueueResult>;
  /** Sends the outbox, then reads what changed. */
  readonly sync: () => Promise<void>;
  /**
   * Syncs now, then on the way back of the network, when the app comes back to the foreground and every 30 s while it is visible, a failed send
   * being tried again sooner with a growing wait; gives the function that stops it all.
   */
  readonly start: () => () => void;
  /** Remembers who I am on this phone. */
  readonly chooseMember: (member: MemberId) => void;
  /**
   * Shows the group a route that edits it answered (title, members), then reads it again with its changes. A read that started before keeps this
   * group when it ends: it would otherwise bring back the members as they were, and an expense on a member just added would be refused.
   */
  readonly applyGroup: (group: GroupResponse) => void;
}

type PassResult = 'empty' | 'sent' | 'failed';

const start = cursorSchema.parse(0);
const SYNC_INTERVAL = 30_000;
const FIRST_RETRY = 1_000;

/**
 * The group of one link, read by the screens through `useSyncExternalStore` and kept on the phone by `openDb`. A read is published and saved only
 * once complete (a page with `hasMore: false`): balances computed from part of the changes would leave operations out. Without storage (refused,
 * private browsing), the group and its outbox live in memory only.
 */
export function createGroupStore(client: ApiClient, token: string, openDb: () => Promise<GroupDb> = () => openGroupDb(token)): GroupStore {
  let state: GroupState = { status: 'loading' };
  const listeners = new Set<() => void>();
  let reading: Promise<void> | undefined;
  let currentMember: MemberId | undefined;
  let outbox: readonly Queued[] = [];
  // Keys of the outbox kept in memory, without storage.
  let memoryKey = 0;
  let persistenceAsked = false;
  const db = openDb().catch(() => undefined);
  // Opened and read once, before the first read from the server.
  let restored: Promise<void> | undefined;
  const restoreOnce = () => (restored ??= restore());
  // Whether the last read published was also saved on the phone.
  let lastReadSaved = false;
  let flushing: Promise<boolean> | undefined;
  // Counts the calls of `flush`, so that one that comes during a pass makes it run again.
  let flushRequests = 0;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  // Counts the groups applied from an edit, so that a read started before one does not publish the group it fetched earlier.
  let applied = 0;

  const publish = (next: GroupState) => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };
  const queued = () => outbox.map((entry) => entry.operation);
  const publishOutbox = () => {
    if (state.status === 'ready') {
      publish({ ...state, outbox: queued() });
    }
  };

  async function restore(): Promise<void> {
    const opened = await db;
    const [copy, member, stored] = await Promise.all([opened?.loadCopy(), opened?.loadCurrentMember(), opened?.loadOutbox()]).catch(
      () => [undefined, undefined, undefined] as const,
    );
    currentMember = member;
    outbox = stored ?? [];
    if (copy !== undefined) {
      publish({ status: 'ready', ...copy, outbox: queued(), currentMember });
    }
  }

  async function save(completed: CompleteRead): Promise<GroupState> {
    // Built once the saves are done, for who I am or the outbox may have changed meanwhile.
    const inMemory = (): GroupState => ({
      status: 'ready',
      group: completed.group,
      changes: completed.known,
      cursor: completed.cursor,
      readAt: Date.now(),
      outbox: queued(),
      currentMember,
    });
    const opened = await db;
    lastReadSaved = false;
    if (opened === undefined) {
      return inMemory();
    }
    try {
      const saved = await opened.saveRead(completed);
      lastReadSaved = true;
      if (!persistenceAsked) {
        persistenceAsked = true;
        void askPersistentStorage().catch(() => undefined);
      }
      return { status: 'ready', ...saved, outbox: queued(), currentMember };
    } catch {
      // Not saved (storage full, database closed by a newer version of the app, until the app reloads): the read still shows, and the next save
      // that finds the stored copy short of where it started writes the whole copy.
      return inMemory();
    }
  }

  async function read(): Promise<GroupState> {
    await restoreOnce();
    const group = await client.fetchGroup(token);
    if (!group.ok) {
      return { status: 'error', error: group.error };
    }
    let known = new Map(state.status === 'ready' ? state.changes : []);
    let since = state.status === 'ready' ? state.cursor : start;
    let reset = false;
    let cursor = since;
    // The revision received at the cursor, which the server checks to tell a database restored behind it.
    let revision = since === start ? undefined : [...known.values()].find((change) => change.seq === since)?.revisionId;
    const changes: Change[] = [];
    // Drops the copy and reads it all again; the outbox stays.
    const restart = () => {
      known = new Map();
      since = start;
      reset = true;
      cursor = start;
      revision = undefined;
      changes.length = 0;
    };
    if (since !== start && revision === undefined) {
      // A copy that lacks the change at its cursor cannot name it.
      restart();
    }
    for (;;) {
      const page = await client.fetchChanges(token, cursor, revision);
      if (!page.ok) {
        // The database was restored behind our cursor: what the copy holds past the restored point no longer exists. Once only.
        if (page.error === 'unknown_cursor' && since !== start) {
          restart();
          continue;
        }
        return { status: 'error', error: page.error === 'unknown_cursor' ? 'unexpected' : page.error };
      }
      for (const change of page.value.changes) {
        changes.push(change);
        known.set(change.id, change);
      }
      cursor = page.value.cursor;
      revision = page.value.changes.at(-1)?.revisionId ?? revision;
      if (!page.value.hasMore) {
        return save({ group: group.value, since, changes, cursor, known, reset });
      }
    }
  }

  function load(): Promise<void> {
    if (reading === undefined) {
      if (state.status === 'error') {
        publish({ status: 'loading' });
      }
      const appliedBefore = applied;
      reading = read()
        // A group already shown stays on screen when a read fails, with the error beside it.
        .then((next) => {
          if (state.status === 'ready' && next.status === 'error') {
            publish({ ...state, readError: next.error });
          } else if (state.status === 'ready' && next.status === 'ready' && applied !== appliedBefore) {
            publish({ ...next, group: state.group });
          } else {
            publish(next);
          }
        })
        .finally(() => {
          reading = undefined;
        });
    }
    return reading;
  }

  async function removeFromOutbox(keys: readonly number[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    await (await db)?.removeFromOutbox(keys);
    outbox = outbox.filter((entry) => !keys.includes(entry.key));
    publishOutbox();
  }

  /**
   * Sends the outbox by batches, in the order of entry, one request at a time and without merging revisions of one operation: an old revision
   * arriving after a newer one would win. Each revision leaves the outbox once answered: refused ones at once, without notice (docs/decisions/conflits-hors-ligne.md);
   * written ones and resends once a read made after the send has brought the server's copy, and saved it on the phone, so that the operation never
   * disappears from the screen in between, nor from the copy the app opens on. Gives whether the outbox is empty, and whether that took a read.
   */
  async function pass(): Promise<PassResult> {
    const opened = await db;
    let sent = false;
    for (;;) {
      if (opened !== undefined) {
        // Read again under the lock: another window may have sent part of it.
        const stored = await opened.loadOutbox();
        if (outbox.some((entry) => !stored.some((kept) => kept.key === entry.key))) {
          await showStoredCopy();
        }
        outbox = stored;
        publishOutbox();
      }
      const batch = outbox.slice(0, MAX_BATCH_REVISIONS);
      if (batch.length === 0) {
        return sent ? 'sent' : 'empty';
      }
      const answer = await client.sendOperations(
        token,
        batch.map((entry) => entry.operation),
      );
      if (!answer.ok) {
        return 'failed';
      }
      await removeFromOutbox(batch.filter((_, index) => answer.value[index]?.status === 'rejected').map((entry) => entry.key));
      // A read that started before the send may have missed it: wait for it, then read again.
      await reading;
      await load();
      if (state.status !== 'ready' || state.readError !== undefined || (opened !== undefined && !lastReadSaved)) {
        // Written but not read back, or not saved: sent again next time, the server answering `duplicate`.
        return 'failed';
      }
      await removeFromOutbox(batch.map((entry) => entry.key));
      sent = true;
    }
  }

  /**
   * The window that sent part of the outbox saved the server's copy holding it before taking it out: shown here too, so that the operation never
   * leaves the screen, even when this window cannot read the server.
   */
  async function showStoredCopy(): Promise<void> {
    const copy = await (await db)?.loadCopy().catch(() => undefined);
    if (copy !== undefined && state.status === 'ready' && copy.cursor >= state.cursor) {
      publish({ ...state, ...copy });
    }
  }

  /** One sender for every window of the group: the lock of its database, held for a whole pass. */
  async function exclusive(run: () => Promise<PassResult>) {
    const opened = await db;
    // Missing from older browsers (Safari before 15.4), null in test environments, though the DOM types declare it.
    const locks = navigator.locks as LockManager | null | undefined;
    return opened === undefined || locks === undefined || locks === null ? run() : locks.request(`${opened.name}-outbox`, run);
  }

  function scheduleRetry() {
    failures += 1;
    clearTimeout(retry);
    if (started) {
      retry = setTimeout(() => void sync(), Math.min(SYNC_INTERVAL, FIRST_RETRY * 2 ** (failures - 1)));
    }
  }

  /** Gives whether a read followed what was sent. */
  function flush(): Promise<boolean> {
    flushRequests += 1;
    if (flushing !== undefined) {
      return flushing;
    }
    flushing = (async () => {
      let readBack = false;
      for (;;) {
        const requests = flushRequests;
        const result = await exclusive(pass).catch(() => 'failed' as const);
        if (result === 'failed') {
          scheduleRetry();
          return readBack;
        }
        readBack ||= result === 'sent';
        if (flushRequests === requests) {
          failures = 0;
          clearTimeout(retry);
          return readBack;
        }
      }
    })().finally(() => {
      flushing = undefined;
    });
    return flushing;
  }

  async function sync(): Promise<void> {
    await restoreOnce();
    if (!(await flush())) {
      await load();
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    load,
    sync,
    async enqueue(operation) {
      // The server would refuse it: checked before queuing, so that the person can still change it.
      if (state.status === 'ready' && unknownMembers(operation, new Set(state.group.members.map((member) => member.id))).length > 0) {
        return { ok: false, error: 'unknown_member' };
      }
      const opened = await db;
      let key: number;
      try {
        key = opened === undefined ? ++memoryKey : await opened.addToOutbox(operation);
      } catch {
        return { ok: false, error: 'not_stored' };
      }
      // A pass may have read the outbox again since the revision was stored.
      if (!outbox.some((entry) => entry.key === key)) {
        outbox = [...outbox, { key, operation }];
      }
      publishOutbox();
      void flush();
      return { ok: true };
    },
    start() {
      started = true;
      const wake = () => void sync();
      const wakeIfVisible = () => {
        if (document.visibilityState === 'visible') {
          wake();
        }
      };
      // `navigator.onLine` is never trusted alone: a request tells whether the server answers.
      window.addEventListener('online', wake);
      document.addEventListener('visibilitychange', wakeIfVisible);
      const interval = setInterval(wakeIfVisible, SYNC_INTERVAL);
      wake();
      return () => {
        started = false;
        window.removeEventListener('online', wake);
        document.removeEventListener('visibilitychange', wakeIfVisible);
        clearInterval(interval);
        clearTimeout(retry);
      };
    },
    chooseMember(member) {
      currentMember = member;
      if (state.status === 'ready') {
        publish({ ...state, currentMember });
      }
      void db.then((opened) => opened?.saveCurrentMember(member)).catch(() => undefined);
    },
    applyGroup(group) {
      applied += 1;
      if (state.status === 'ready') {
        publish({ ...state, group });
      }
      // After the read running now, if any: that one fetched the group too early.
      void (async () => {
        await reading;
        await load();
      })();
    },
  };
}
