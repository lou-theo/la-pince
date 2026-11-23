import { type PushMessage, pushMessageSchema } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { notificationOf, pathOf } from './notification.ts';

const group = { token: 'abcdefghijklmnopqrstuvwxyz_0123456789-AB', title: 'Week-end' };
const notice = (kind: 'added' | 'changed' | 'deleted', title: string, operationId = 'op1') => ({
  kind,
  operationId,
  title,
  author: 'm2',
  authorName: 'Bruno',
});
const operations = (count: number, notices: ReturnType<typeof notice>[]): PushMessage =>
  pushMessageSchema.parse({ type: 'operations', groupId: 'week-end', count, notices });

describe('notificationOf', () => {
  it('tells one change by its author and title, and opens the operation', () => {
    expect(notificationOf(operations(1, [notice('added', 'Pizza')]), group)).toStrictEqual({
      title: 'Week-end',
      body: 'Bruno a ajouté « Pizza »',
      path: `/g/${group.token}/operations/op1`,
    });
    expect(notificationOf(operations(1, [notice('changed', 'Pizza')]), group).body).toBe('Bruno a modifié « Pizza »');
  });

  it('opens the group for a deletion, whose operation no longer shows', () => {
    expect(notificationOf(operations(1, [notice('deleted', 'Pizza')]), group)).toStrictEqual({
      title: 'Week-end',
      body: 'Bruno a supprimé « Pizza »',
      path: `/g/${group.token}`,
    });
  });

  it('lists the changes of a batch one per line, says how many more there were, and opens the group', () => {
    const notices = [notice('added', 'Pizza', 'a'), notice('deleted', 'Taxi', 'b')];
    expect(notificationOf(operations(2, notices), group)).toStrictEqual({
      title: 'Week-end',
      body: 'Bruno a ajouté « Pizza »\nBruno a supprimé « Taxi »',
      path: `/g/${group.token}`,
    });
    expect(notificationOf(operations(9, notices), group).body).toBe('Bruno a ajouté « Pizza »\nBruno a supprimé « Taxi »\nEt 7 de plus');
  });

  it('confirms a test notification in the group', () => {
    expect(notificationOf(pushMessageSchema.parse({ type: 'test', groupId: 'week-end' }), group)).toStrictEqual({
      title: 'Week-end',
      body: 'Les notifications marchent sur cet appareil.',
      path: `/g/${group.token}`,
    });
  });

  it('still shows a notification that opens the app for a message it cannot read or a group it no longer knows', () => {
    const fallback = { title: 'La Pince', body: 'Du nouveau dans un de tes groupes.', path: '/' };
    expect(notificationOf(undefined, group)).toStrictEqual(fallback);
    expect(notificationOf(operations(1, [notice('added', 'Pizza')]), undefined)).toStrictEqual(fallback);
  });
});

describe('pathOf', () => {
  it('opens the path a notification was shown with, and the home for anything else', () => {
    expect(pathOf({ path: `/g/${group.token}/operations/op1` })).toBe(`/g/${group.token}/operations/op1`);
    expect(pathOf({ path: 'https://elsewhere.example/' })).toBe('/');
    expect(pathOf({ path: 3 })).toBe('/');
    expect(pathOf({})).toBe('/');
    expect(pathOf(null)).toBe('/');
    expect(pathOf(undefined)).toBe('/');
  });
});
