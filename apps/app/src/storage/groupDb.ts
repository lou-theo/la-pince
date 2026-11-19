import {
  type Change,
  changeSchema,
  type Cursor,
  cursorSchema,
  type GroupResponse,
  groupResponseSchema,
  type MemberId,
  memberIdSchema,
  type Operation,
  type OperationId,
} from '@la-pince/core';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { z } from 'zod';

/** The last complete read of a group: its title and members, the current revision of each operation, deleted ones included, and the cursor. */
export interface GroupCopy {
  readonly group: GroupResponse;
  readonly changes: ReadonlyMap<OperationId, Change>;
  readonly cursor: Cursor;
}

/** A read ended by a page with `hasMore: false`, to save. */
export interface CompleteRead {
  readonly group: GroupResponse;
  /** The cursor the read started from, and the changes it brought since. */
  readonly since: Cursor;
  readonly changes: readonly Change[];
  readonly cursor: Cursor;
  /** The whole copy the window holds once the read is applied: every change up to `cursor`. */
  readonly known: ReadonlyMap<OperationId, Change>;
  /** The server's history was rebuilt (`cursor_ahead`): what is stored may hold operations the server no longer has. */
  readonly reset: boolean;
}

/** The copy of one group kept on this phone, so that the app opens without network. */
export interface GroupDb {
  /** The last complete read, or nothing before the first one; a copy that no longer matches the schemas of the core is dropped. */
  readonly loadCopy: () => Promise<GroupCopy | undefined>;
  /** Saves a complete read in one transaction, then gives the copy as stored, which another window of the same group may have moved further. */
  readonly saveRead: (read: CompleteRead) => Promise<GroupCopy>;
  readonly loadCurrentMember: () => Promise<MemberId | undefined>;
  readonly saveCurrentMember: (member: MemberId) => Promise<void>;
}

// `read`: the last complete read; `currentMember`: who I am in the group, as chosen on this phone.
const storedReadSchema = z.strictObject({
  group: groupResponseSchema,
  cursor: cursorSchema,
  /** When the read ended, in milliseconds since the epoch. */
  readAt: z.int().nonnegative(),
});

interface Schema extends DBSchema {
  /** The server's copy: the current revision of each operation, by operation id. */
  operations: { key: OperationId; value: Change };
  meta: { key: 'read' | 'currentMember'; value: unknown };
  /** Revisions entered on this phone and not yet acknowledged by the server, by order of entry. */
  outbox: { key: number; value: Operation };
}

/**
 * Opens the copy of the group of a link. One database per group, named after the SHA-256 of the link's token: the token itself, which gives write
 * access to the group, appears in no name that the browser lists.
 */
export async function openGroupDb(token: string): Promise<GroupDb> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const db: IDBPDatabase<Schema> = await openDB<Schema>(`la-pince-group-${hex}`, 1, {
    upgrade(database) {
      database.createObjectStore('operations', { keyPath: 'id' });
      database.createObjectStore('meta');
      database.createObjectStore('outbox', { autoIncrement: true });
    },
    // A newer version of the app, open in another window, waits for this connection to close before changing the schema.
    blocking() {
      db.close();
    },
  });

  return {
    async loadCopy() {
      const transaction = db.transaction(['operations', 'meta'], 'readwrite');
      const meta = transaction.objectStore('meta');
      const operations = transaction.objectStore('operations');
      const [stored, records] = await Promise.all([meta.get('read'), operations.getAll()]);
      const read = storedReadSchema.safeParse(stored);
      const changes = new Map<OperationId, Change>();
      for (const record of records) {
        const parsed = changeSchema.safeParse(record);
        if (parsed.success) {
          changes.set(parsed.data.id, parsed.data);
        }
      }
      if (read.success && changes.size === records.length) {
        await transaction.done;
        return { group: read.data.group, changes, cursor: read.data.cursor };
      }
      // Dropped, so that the next save, finding no copy, writes a whole one instead of merging into records it cannot read.
      await Promise.all([meta.delete('read'), operations.clear()]);
      await transaction.done;
      return undefined;
    },

    async saveRead({ group, since, changes, cursor, known, reset }) {
      const transaction = db.transaction(['operations', 'meta'], 'readwrite');
      const operations = transaction.objectStore('operations');
      const meta = transaction.objectStore('meta');
      try {
        const previous = storedReadSchema.safeParse(await meta.get('read'));
        let saved = cursor;
        let savedGroup = group;
        if (reset || !previous.success || previous.data.cursor < since) {
          // No copy, or one that misses changes before the read started (an earlier save failed): the window's whole copy replaces it.
          await operations.clear();
          for (const change of known.values()) {
            await operations.put(change);
          }
        } else {
          // The stored copy holds every change up to its cursor, at or past where the read started, and another window may have saved it further:
          // keep the most recent revision of each operation and the furthest cursor, so that the copy still holds every change up to its cursor.
          if (previous.data.cursor > cursor) {
            // Title and members go with the cursor kept: the other window read them later.
            saved = previous.data.cursor;
            savedGroup = previous.data.group;
          }
          for (const change of changes) {
            const current = await operations.get(change.id);
            if (current === undefined || current.seq < change.seq) {
              await operations.put(change);
            }
          }
        }
        await meta.put({ group: savedGroup, cursor: saved, readAt: Date.now() } satisfies z.input<typeof storedReadSchema>, 'read');
        const all = await operations.getAll();
        await transaction.done;
        return { group: savedGroup, changes: new Map(all.map((change) => [change.id, change])), cursor: saved };
      } catch (error) {
        // A request that throws (a value the browser cannot store) does not abort the transaction by itself: what was written before would stay.
        void transaction.done.catch(() => undefined);
        try {
          transaction.abort();
        } catch {
          // Already ended: it failed on its own (storage full at commit), nothing was written.
        }
        throw error;
      }
    },

    async loadCurrentMember() {
      const parsed = memberIdSchema.safeParse(await db.get('meta', 'currentMember'));
      return parsed.success ? parsed.data : undefined;
    },

    async saveCurrentMember(member) {
      await db.put('meta', member, 'currentMember');
    },
  };
}

/**
 * Asks the browser to keep this site's storage under pressure, and Safari not to erase it after 7 days without a visit; nothing is shown either way.
 * Firefox may ask the person through its own prompt.
 */
export async function askPersistentStorage(): Promise<void> {
  // Missing from older browsers and from test environments, though the DOM types declare it.
  const storage = navigator.storage as StorageManager | undefined;
  if (storage === undefined || (await storage.persisted())) {
    return;
  }
  await storage.persist();
}
