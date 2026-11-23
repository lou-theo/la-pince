import { type GroupId, groupIdSchema, groupTitleSchema, groupTokenSchema, type MemberId, memberIdSchema } from '@la-pince/core';
import { type DBSchema, openDB } from 'idb';
import { z } from 'zod';

const notifiedGroupSchema = z.strictObject({
  groupId: groupIdSchema,
  token: groupTokenSchema,
  title: groupTitleSchema,
  /** Address of this phone at its push service when it subscribed to the group. */
  endpoint: z.string(),
  /** The member the server sends this phone the notices of. */
  member: memberIdSchema,
});

/** A group this phone receives the notifications of, as the server last saved its subscription. */
export interface NotifiedGroup {
  readonly groupId: GroupId;
  readonly token: string;
  readonly title: string;
  readonly endpoint: string;
  readonly member: MemberId;
}

interface Schema extends DBSchema {
  groups: { key: string; value: unknown };
}

/**
 * The groups this phone receives notifications from, by group id, which is all a push message names: the service worker reads it to title the
 * notification and open the group's link. One database for the whole phone, apart from the copies of the groups (`groupDb.ts`), since the service
 * worker knows no token. An entry that no longer matches its schema is skipped, as if the phone were not subscribed.
 */
export interface NotificationDb {
  readonly all: () => Promise<NotifiedGroup[]>;
  readonly get: (groupId: GroupId) => Promise<NotifiedGroup | undefined>;
  readonly put: (group: NotifiedGroup) => Promise<void>;
  readonly remove: (groupId: GroupId) => Promise<void>;
}

export async function openNotificationDb(): Promise<NotificationDb> {
  const db = await openDB<Schema>('la-pince-notifications', 1, {
    upgrade(database) {
      database.createObjectStore('groups', { keyPath: 'groupId' });
    },
    blocking() {
      db.close();
    },
  });
  const read = (stored: unknown): NotifiedGroup | undefined => {
    const parsed = notifiedGroupSchema.safeParse(stored);
    return parsed.success ? parsed.data : undefined;
  };
  return {
    async all() {
      return (await db.getAll('groups')).flatMap((stored) => read(stored) ?? []);
    },
    async get(groupId) {
      return read(await db.get('groups', groupId));
    },
    async put(group) {
      await db.put('groups', group);
    },
    async remove(groupId) {
      await db.delete('groups', groupId);
    },
  };
}
