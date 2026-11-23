import { groupIdSchema, memberIdSchema } from '@la-pince/core';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';

import { type NotifiedGroup, openNotificationDb } from './notificationDb.ts';

const entry = (id: string, endpoint = `https://fcm.googleapis.com/fcm/send/${id}`): NotifiedGroup => ({
  groupId: groupIdSchema.parse(id),
  token: `${id}-token-${'x'.repeat(32)}`,
  title: 'Week-end',
  endpoint,
  member: memberIdSchema.parse('m1'),
});

describe('openNotificationDb', () => {
  it('keeps the groups this phone is subscribed to by group id, across openings', async () => {
    const db = await openNotificationDb();
    await db.put(entry('a'));
    await db.put(entry('b'));
    await db.put({ ...entry('a'), member: memberIdSchema.parse('m2') });
    const again = await openNotificationDb();
    expect(await again.get(groupIdSchema.parse('a'))).toStrictEqual({ ...entry('a'), member: 'm2' });
    expect((await again.all()).map((group) => group.groupId)).toStrictEqual(['a', 'b']);
    await again.remove(groupIdSchema.parse('a'));
    expect(await again.get(groupIdSchema.parse('a'))).toBeUndefined();
    expect((await again.all()).map((group) => group.groupId)).toStrictEqual(['b']);
  });

  it('skips an entry that no longer matches its schema', async () => {
    const db = await openNotificationDb();
    await db.put(entry('a'));
    const raw = await openDB('la-pince-notifications', 1);
    await raw.put('groups', { groupId: 'old', token: 'short' });
    raw.close();
    expect(await db.get(groupIdSchema.parse('old'))).toBeUndefined();
    expect((await db.all()).map((group) => group.groupId)).toStrictEqual(['a']);
  });
});
