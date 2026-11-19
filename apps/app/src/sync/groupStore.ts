import { type Change, type Cursor, cursorSchema, type GroupResponse, type OperationId } from '@la-pince/core';

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
    };

export interface GroupStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => GroupState;
  /** Reads the group and every change since the last read; a call during a read waits for that read. */
  readonly load: () => Promise<void>;
}

const start = cursorSchema.parse(0);

/**
 * The group of one link, kept in memory and read by the screens through `useSyncExternalStore`. A read is published only once complete (a page with
 * `hasMore: false`): balances computed from part of the changes would leave operations out.
 */
export function createGroupStore(client: ApiClient, token: string): GroupStore {
  let state: GroupState = { status: 'loading' };
  const listeners = new Set<() => void>();
  let reading: Promise<void> | undefined;

  const publish = (next: GroupState) => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };

  async function read(): Promise<GroupState> {
    const group = await client.fetchGroup(token);
    if (!group.ok) {
      return { status: 'error', error: group.error };
    }
    let changes = new Map(state.status === 'ready' ? state.changes : []);
    let cursor = state.status === 'ready' ? state.cursor : start;
    let restarted = false;
    for (;;) {
      const page = await client.fetchChanges(token, cursor);
      if (!page.ok) {
        // The server's history was rebuilt behind our cursor: drop the copy and read it all again, once.
        if (page.error === 'cursor_ahead' && !restarted) {
          restarted = true;
          changes = new Map();
          cursor = start;
          continue;
        }
        return { status: 'error', error: page.error === 'cursor_ahead' ? 'unexpected' : page.error };
      }
      for (const change of page.value.changes) {
        changes.set(change.id, change);
      }
      cursor = page.value.cursor;
      if (!page.value.hasMore) {
        return { status: 'ready', group: group.value, changes, cursor };
      }
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
    load() {
      if (reading === undefined) {
        if (state.status === 'error') {
          publish({ status: 'loading' });
        }
        reading = read()
          .then(publish)
          .finally(() => {
            reading = undefined;
          });
      }
      return reading;
    },
  };
}
