import { describe, expect, it } from 'vitest';

import type { MemberId, OperationId } from './ids.ts';
import {
  endpointRequestSchema,
  MAX_PUSH_NOTICES,
  type Notice,
  noticesByMember,
  pushKeyResponseSchema,
  pushMessageSchema,
  pushSubscriptionSchema,
  subscribeRequestSchema,
} from './notifications.ts';
import { type Operation, operationSchema } from './operation.ts';

interface Revision {
  readonly id?: string;
  readonly title?: string;
  readonly payer?: string;
  readonly lines?: readonly ({ member: string; amount: number } | { member: string; weight: number })[];
  readonly total?: number;
  readonly author?: string;
  readonly deleted?: true;
}

let revisions = 0;
const revision = ({
  id = 'op1',
  title = 'Pizza',
  payer = 'max',
  lines = [{ member: 'lea', weight: 1 }],
  total = 2500,
  author,
  deleted,
}: Revision): Operation => {
  revisions += 1;
  return operationSchema.parse({
    id,
    revisionId: `rev${String(revisions)}`,
    title,
    date: '2026-11-19',
    ...(author === undefined ? {} : { author }),
    ...(deleted === true ? { deleted } : { entry: { version: 1, kind: 'expense', payer, total, lines } }),
  });
};

const previousOf = (...operations: Operation[]): Map<OperationId, Operation> => new Map(operations.map((operation) => [operation.id, operation]));
const notified = (notices: Map<MemberId, Notice[]>) =>
  Object.fromEntries([...notices].map(([member, list]) => [member, list.map((notice) => `${notice.kind} ${notice.operationId} ${notice.title}`)]));

describe('noticesByMember', () => {
  it('tells the payer and the members with a share about an added operation, not its author nor the others', () => {
    const pizza = revision({
      lines: [
        { member: 'lea', weight: 1 },
        { member: 'max', weight: 1 },
      ],
      author: 'max',
      payer: 'tom',
    });
    expect(notified(noticesByMember(new Map(), [pizza]))).toStrictEqual({ tom: ['added op1 Pizza'], lea: ['added op1 Pizza'] });
    expect(noticesByMember(new Map(), [pizza]).get('lea' as MemberId)).toStrictEqual([
      { kind: 'added', operationId: 'op1', title: 'Pizza', author: 'max' },
    ]);
  });

  it('leaves out a member whose share comes to nothing', () => {
    // One cent shared by two: one of them gets nothing.
    const cent = revision({
      lines: [
        { member: 'lea', weight: 1 },
        { member: 'tom', weight: 1 },
      ],
      total: 1,
      author: 'max',
    });
    expect(noticesByMember(new Map(), [cent]).size).toBe(1);
  });

  it('tells, about a change, the members concerned before or after it, under the new title', () => {
    const before = revision({ lines: [{ member: 'lea', weight: 1 }], author: 'max' });
    const after = revision({ title: 'Pizzas', lines: [{ member: 'tom', weight: 1 }], author: 'max' });
    expect(notified(noticesByMember(previousOf(before), [after]))).toStrictEqual({ lea: ['changed op1 Pizzas'], tom: ['changed op1 Pizzas'] });
  });

  it('tells the members the deleted version concerned about a deletion', () => {
    const before = revision({ lines: [{ member: 'lea', weight: 1 }], author: 'max' });
    expect(notified(noticesByMember(previousOf(before), [revision({ deleted: true, author: 'max' })]))).toStrictEqual({
      lea: ['deleted op1 Pizza'],
    });
  });

  it('tells no one about the deletion of an operation it never had, nor counts a restored one as changed', () => {
    const deletion = revision({ deleted: true, author: 'max' });
    expect(notified(noticesByMember(new Map(), [deletion]))).toStrictEqual({});
    expect(notified(noticesByMember(previousOf(deletion), [revision({ author: 'max' })]))).toStrictEqual({ lea: ['added op1 Pizza'] });
  });

  it('tells no one about a revision without an author, which only an import writes', () => {
    expect(notified(noticesByMember(new Map(), [revision({})]))).toStrictEqual({});
  });

  it('tells the author of a revision about one another member entered', () => {
    const pizza = revision({
      lines: [
        { member: 'lea', weight: 1 },
        { member: 'max', weight: 1 },
      ],
      author: 'max',
    });
    const changed = revision({
      title: 'Pizzas',
      lines: [
        { member: 'lea', weight: 1 },
        { member: 'max', weight: 1 },
      ],
      author: 'lea',
    });
    expect(notified(noticesByMember(new Map(), [pizza, changed]))).toStrictEqual({ lea: ['added op1 Pizza'], max: ['changed op1 Pizzas'] });
  });

  it('makes one notice of several revisions of one operation in the batch, in the order first written', () => {
    const batch = [
      revision({ id: 'op1', author: 'max' }),
      revision({ id: 'op2', title: 'Train', author: 'max' }),
      revision({ id: 'op1', title: 'Pizzas', author: 'max' }),
    ];
    expect(notified(noticesByMember(new Map(), batch))).toStrictEqual({ lea: ['added op1 Pizzas', 'added op2 Train'] });
    const before = revision({ id: 'op3', title: 'Hotel', author: 'max' });
    const changedThenDeleted = [revision({ id: 'op3', title: 'Hôtel', author: 'max' }), revision({ id: 'op3', deleted: true, author: 'max' })];
    expect(notified(noticesByMember(previousOf(before), changedThenDeleted))).toStrictEqual({ lea: ['deleted op3 Pizza'] });
    const changedTwice = [revision({ id: 'op3', title: 'Hôtel', author: 'max' }), revision({ id: 'op3', title: 'Hôtel 2', author: 'max' })];
    expect(notified(noticesByMember(previousOf(before), changedTwice))).toStrictEqual({ lea: ['changed op3 Hôtel 2'] });
  });

  it('tells no one about an operation added then deleted in the same batch, only about the rest of the batch', () => {
    const undone = [
      revision({ id: 'op1', author: 'max' }),
      revision({ id: 'op2', title: 'Train', author: 'max' }),
      revision({ id: 'op1', deleted: true, author: 'max' }),
    ];
    expect(notified(noticesByMember(new Map(), undone))).toStrictEqual({ lea: ['added op2 Train'] });
    expect(noticesByMember(new Map(), [revision({ author: 'max' }), revision({ deleted: true, author: 'max' })]).size).toBe(0);
    // Added, changed, then deleted: still nothing; deleted then added again: new to the member.
    const changedBetween = [revision({ author: 'max' }), revision({ title: 'Pizzas', author: 'max' }), revision({ deleted: true, author: 'max' })];
    expect(notified(noticesByMember(new Map(), changedBetween))).toStrictEqual({});
    const addedAgain = [revision({ author: 'max' }), revision({ deleted: true, author: 'max' }), revision({ title: 'Pizzas', author: 'max' })];
    expect(notified(noticesByMember(new Map(), addedAgain))).toStrictEqual({ lea: ['added op1 Pizzas'] });

    // Whoever it concerned along the way, and whoever entered each revision.
    const movedThenDeleted = [
      revision({ lines: [{ member: 'lea', weight: 1 }], author: 'max' }),
      revision({ lines: [{ member: 'tom', weight: 1 }], author: 'max' }),
      revision({ deleted: true, author: 'max' }),
    ];
    expect(notified(noticesByMember(new Map(), movedThenDeleted))).toStrictEqual({});
    const deletedByAnother = [revision({ author: 'max' }), revision({ deleted: true, author: 'lea' })];
    expect(notified(noticesByMember(new Map(), deletedByAnother))).toStrictEqual({});
    // Restored then deleted again: it was deleted before the batch, still nobody saw it.
    const restored = [revision({ author: 'max' }), revision({ deleted: true, author: 'max' })];
    expect(notified(noticesByMember(previousOf(revision({ deleted: true })), restored))).toStrictEqual({});
  });

  it('tells each member what changed for them between the version before the batch and the last one, not what came between', () => {
    const forLea = revision({ lines: [{ member: 'lea', weight: 1 }], author: 'max' });
    const forTom = revision({ lines: [{ member: 'tom', weight: 1 }], author: 'max' });
    const deletion = revision({ deleted: true, author: 'max' });
    // Lived for Léa, moved to Tom then deleted: Léa sees it go, Tom never saw it.
    expect(notified(noticesByMember(previousOf(forLea), [forTom, deletion]))).toStrictEqual({ lea: ['deleted op1 Pizza'] });
    expect(notified(noticesByMember(previousOf(forLea), [deletion, forTom, deletion]))).toStrictEqual({ lea: ['deleted op1 Pizza'] });
    // New, for Léa then for Tom: only Tom has something new.
    expect(notified(noticesByMember(new Map(), [forLea, forTom]))).toStrictEqual({ tom: ['added op1 Pizza'] });
    expect(notified(noticesByMember(new Map(), [forLea, deletion, forTom]))).toStrictEqual({ tom: ['added op1 Pizza'] });
  });

  it('tells an addition then its deletion when they come in two batches', () => {
    const added = revision({ author: 'max' });
    expect(notified(noticesByMember(new Map(), [added]))).toStrictEqual({ lea: ['added op1 Pizza'] });
    expect(notified(noticesByMember(previousOf(added), [revision({ deleted: true, author: 'max' })]))).toStrictEqual({ lea: ['deleted op1 Pizza'] });
  });

  // docs/decisions/notifications.md (g): nothing is sized on the largest group seen (13 members).
  it.each([13, 40])('tells every member of a group of %i but the author, each once', (size) => {
    const members = Array.from({ length: size }, (_, index) => `m${String(index)}`);
    const dinner = revision({ payer: 'm0', lines: members.map((member) => ({ member, weight: 1 })), author: 'm0' });
    const notices = noticesByMember(new Map(), [dinner]);
    expect([...notices.keys()].toSorted()).toStrictEqual(members.slice(1).toSorted());
    expect([...notices.values()].every((list) => list.length === 1)).toBe(true);
  });
});

const keys = { p256dh: `B${'a'.repeat(86)}`, auth: 'b'.repeat(22) };

describe('pushSubscriptionSchema', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('accepts a subscription to the push service at %s, dropping other fields', (endpoint) => {
    expect(pushSubscriptionSchema.parse({ endpoint, expirationTime: null, keys })).toStrictEqual({ endpoint, keys });
  });

  it.each([
    ['another host', 'https://example.com/push'],
    ['a host that only ends like a push service', 'https://evilfcm.googleapis.com.example.com/x'],
    ['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['an endpoint over 1000 characters', `https://fcm.googleapis.com/${'a'.repeat(1000)}`],
    ['no address', 'not a url'],
  ])('rejects %s', (_, endpoint) => {
    expect(pushSubscriptionSchema.safeParse({ endpoint, keys }).success).toBe(false);
  });

  it.each([
    ['a short key', { ...keys, p256dh: 'a'.repeat(86) }],
    ['a secret in base64 with padding', { ...keys, auth: `${'b'.repeat(20)}==` }],
    ['a missing secret', { p256dh: keys.p256dh }],
  ])('rejects %s', (_, badKeys) => {
    expect(pushSubscriptionSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: badKeys }).success).toBe(false);
  });
});

describe('request and response schemas', () => {
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys };

  it('reads a subscription with its member, and nothing else', () => {
    expect(subscribeRequestSchema.parse({ member: 'lea', subscription })).toStrictEqual({ member: 'lea', subscription });
    expect(subscribeRequestSchema.safeParse({ member: 'lea', subscription, all: true }).success).toBe(false);
    expect(subscribeRequestSchema.safeParse({ member: 'l e a', subscription }).success).toBe(false);
  });

  it('reads an endpoint, from any host so that a subscription kept from before can still be stopped', () => {
    expect(endpointRequestSchema.parse({ endpoint: 'https://example.com/push' })).toStrictEqual({ endpoint: 'https://example.com/push' });
    expect(endpointRequestSchema.safeParse({}).success).toBe(false);
  });

  it('reads a public key of 65 bytes in base64url', () => {
    expect(pushKeyResponseSchema.parse({ publicKey: keys.p256dh })).toStrictEqual({ publicKey: keys.p256dh });
    expect(pushKeyResponseSchema.safeParse({ publicKey: 'abc' }).success).toBe(false);
  });
});

describe('pushMessageSchema', () => {
  const notice = { kind: 'added', operationId: 'op1', title: 'Pizza', author: 'max', authorName: 'Max' };

  it('reads a test message and a message about operations', () => {
    expect(pushMessageSchema.parse({ type: 'test', groupId: 'g1' })).toStrictEqual({ type: 'test', groupId: 'g1' });
    const message = { type: 'operations', groupId: 'g1', count: 7, notices: Array.from({ length: MAX_PUSH_NOTICES }, () => notice) };
    expect(pushMessageSchema.parse(message)).toStrictEqual(message);
  });

  it.each([
    ['no notice', { count: 1, notices: [] }],
    ['too many notices', { count: 6, notices: Array.from({ length: MAX_PUSH_NOTICES + 1 }, () => notice) }],
    ['a count below the notices carried', { count: 1, notices: [notice, notice] }],
    ['an unknown kind', { count: 1, notices: [{ ...notice, kind: 'moved' }] }],
  ])('rejects a message with %s', (_, fields) => {
    expect(pushMessageSchema.safeParse({ type: 'operations', groupId: 'g1', ...fields }).success).toBe(false);
  });
});
