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

/** A read ended by a page with `hasMore: false`, to save: the changes it brought, and whether it started from 0 and so replaces the whole copy. */
export interface CompleteRead {
  readonly group: GroupResponse;
  readonly changes: readonly Change[];
  readonly cursor: Cursor;
  readonly fromStart: boolean;
}

/** The copy of one group kept on this phone, so that the app opens without network. */
export interface GroupDb {
  /** The last complete read, or nothing before the first one or when what is stored no longer matches the schemas of the core. */
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
      const transaction = db.transaction(['operations', 'meta']);
      const [stored, operations] = await Promise.all([transaction.objectStore('meta').get('read'), transaction.objectStore('operations').getAll()]);
      const read = storedReadSchema.safeParse(stored);
      if (!read.success) {
        return undefined;
      }
      const changes = new Map<OperationId, Change>();
      for (const operation of operations) {
        const parsed = changeSchema.safeParse(operation);
        if (!parsed.success) {
          return undefined;
        }
        changes.set(parsed.data.id, parsed.data);
      }
      return { group: read.data.group, changes, cursor: read.data.cursor };
    },

    async saveRead({ group, changes, cursor, fromStart }) {
      const transaction = db.transaction(['operations', 'meta'], 'readwrite');
      const operations = transaction.objectStore('operations');
      const meta = transaction.objectStore('meta');
      let saved = cursor;
      if (fromStart) {
        await operations.clear();
      } else {
        // Another window may have saved a later read: keep the most recent revision of each operation, and the furthest cursor, so that the copy
        // stays every change up to its cursor.
        const previous = storedReadSchema.safeParse(await meta.get('read'));
        if (previous.success && previous.data.cursor > cursor) {
          saved = previous.data.cursor;
        }
      }
      for (const change of changes) {
        const current = fromStart ? undefined : await operations.get(change.id);
        if (current === undefined || current.seq < change.seq) {
          await operations.put(change);
        }
      }
      await meta.put({ group, cursor: saved, readAt: Date.now() } satisfies z.input<typeof storedReadSchema>, 'read');
      const all = await operations.getAll();
      await transaction.done;
      return { group, changes: new Map(all.map((change) => [change.id, change])), cursor: saved };
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
