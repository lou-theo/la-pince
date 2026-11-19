import {
  type Change,
  type Cursor,
  cursorSchema,
  type GroupResponse,
  type MemberId,
  type Operation,
  type OperationId,
  type RejectionReason,
} from '@la-pince/core';

import { askPersistentStorage, type CompleteRead, type GroupDb, openGroupDb } from '../storage/groupDb.ts';
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
      /** Who I am, as chosen on this phone; the screens check it is still a member. */
      readonly currentMember: MemberId | undefined;
      /** Why the last read failed, the group shown being the last one read in full; cleared by the next read that succeeds. */
      readonly readError?: LoadError;
    };

/** Why a revision was not written: the request failed, or the server refused the revision. */
export type SendError = LoadError | RejectionReason;
/** `reread`: whether the group could be read again after the write, so that the screens show it; a revision written but not read back is still written. */
export type SendResult = { readonly ok: true; readonly reread: boolean } | { readonly ok: false; readonly error: SendError };

export interface GroupStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => GroupState;
  /**
   * Reads the group and every change since the last read; a call during a read waits for that read. The first call shows the copy kept on this
   * phone, if any, before asking the server.
   */
  readonly load: () => Promise<void>;
  /** Sends one revision, then reads the group again so that the screens show it as the server wrote it. */
  readonly send: (operation: Operation) => Promise<SendResult>;
  /** Remembers who I am on this phone. */
  readonly chooseMember: (member: MemberId) => void;
}

const start = cursorSchema.parse(0);

/**
 * The group of one link, read by the screens through `useSyncExternalStore` and kept on the phone by `openDb`. A read is published and saved only
 * once complete (a page with `hasMore: false`): balances computed from part of the changes would leave operations out. Without storage (refused,
 * private browsing), the group lives in memory only.
 */
export function createGroupStore(client: ApiClient, token: string, openDb: () => Promise<GroupDb> = () => openGroupDb(token)): GroupStore {
  let state: GroupState = { status: 'loading' };
  const listeners = new Set<() => void>();
  let reading: Promise<void> | undefined;
  let currentMember: MemberId | undefined;
  let persistenceAsked = false;
  const db = openDb().catch(() => undefined);
  // Opened and read once, before the first read from the server.
  let restored: Promise<void> | undefined;

  const publish = (next: GroupState) => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };

  async function restore(): Promise<void> {
    const opened = await db;
    const [copy, member] = await Promise.all([opened?.loadCopy(), opened?.loadCurrentMember()]).catch(() => [undefined, undefined] as const);
    currentMember = member;
    if (copy !== undefined) {
      publish({ status: 'ready', ...copy, currentMember });
    }
  }

  async function save(completed: CompleteRead): Promise<GroupState> {
    const memory = new Map(completed.fromStart || state.status !== 'ready' ? [] : state.changes);
    for (const change of completed.changes) {
      memory.set(change.id, change);
    }
    const inMemory: GroupState = { status: 'ready', group: completed.group, changes: memory, cursor: completed.cursor, currentMember };
    const opened = await db;
    if (opened === undefined) {
      return inMemory;
    }
    try {
      const saved = await opened.saveRead(completed);
      if (!persistenceAsked) {
        persistenceAsked = true;
        void askPersistentStorage().catch(() => undefined);
      }
      return { status: 'ready', ...saved, currentMember };
    } catch {
      // Not saved (storage full, database closed by a newer version of the app): the read still shows, and the next one saves again.
      return inMemory;
    }
  }

  async function read(): Promise<GroupState> {
    await (restored ??= restore());
    const group = await client.fetchGroup(token);
    if (!group.ok) {
      return { status: 'error', error: group.error };
    }
    let cursor = state.status === 'ready' ? state.cursor : start;
    let fromStart = cursor === start;
    let changes: Change[] = [];
    for (;;) {
      const page = await client.fetchChanges(token, cursor);
      if (!page.ok) {
        // The server's history was rebuilt behind our cursor: drop the copy and read it all again, once.
        if (page.error === 'cursor_ahead' && !fromStart) {
          fromStart = true;
          changes = [];
          cursor = start;
          continue;
        }
        return { status: 'error', error: page.error === 'cursor_ahead' ? 'unexpected' : page.error };
      }
      changes.push(...page.value.changes);
      cursor = page.value.cursor;
      if (!page.value.hasMore) {
        return save({ group: group.value, changes, cursor, fromStart });
      }
    }
  }

  function load(): Promise<void> {
    if (reading === undefined) {
      if (state.status === 'error') {
        publish({ status: 'loading' });
      }
      reading = read()
        // A group already shown stays on screen when a read fails, with the error beside it.
        .then((next) => {
          publish(next.status === 'error' && state.status === 'ready' ? { ...state, readError: next.error } : next);
        })
        .finally(() => {
          reading = undefined;
        });
    }
    return reading;
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
    async send(operation) {
      const sent = await client.sendOperations(token, [operation]);
      if (!sent.ok) {
        return sent;
      }
      const [answer] = sent.value;
      if (answer?.status === 'rejected') {
        return { ok: false, error: answer.reason };
      }
      // A read that started before the write may have missed it: wait for it, then read again.
      await reading;
      await load();
      return { ok: true, reread: state.status === 'ready' && state.readError === undefined };
    },
    chooseMember(member) {
      currentMember = member;
      if (state.status === 'ready') {
        publish({ ...state, currentMember });
      }
      void db.then((opened) => opened?.saveCurrentMember(member)).catch(() => undefined);
    },
  };
}
