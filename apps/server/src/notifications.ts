import { buildPushPayload } from '@block65/webcrypto-web-push';
import {
  type GroupId,
  groupIdSchema,
  MAX_PUSH_NOTICES,
  memberIdSchema,
  noticesByMember,
  type Operation,
  type OperationId,
  operationSchema,
  pushMessageSchema,
  type RevisionId,
  type SubscribeRequest,
} from '@la-pince/core';
import { z } from 'zod';

// Raw statements throughout: lists are passed as one JSON parameter (`json_each`), D1 taking at most 100 parameters per statement. Table and
// column names follow `schema.ts`.

/** One push to one phone, as the queue carries it from the request that wrote the revisions to the consumer that encrypts and sends it. */
const notificationMessageSchema = z.strictObject({
  endpoint: z.string(),
  keys: z.strictObject({ p256dh: z.string(), auth: z.string() }),
  groupId: groupIdSchema,
  member: memberIdSchema,
  // The instance's address, the contact VAPID asks for (decision 45 of the cadrage): no e-mail address to configure.
  subject: z.string(),
  message: pushMessageSchema,
});
export type NotificationMessage = z.infer<typeof notificationMessageSchema>;

/** Bindings of the notifications; an instance missing one of them runs without notifications. */
export interface NotificationEnv {
  readonly DB: D1Database;
  readonly NOTIFICATIONS?: Queue<NotificationMessage>;
  readonly VAPID_PUBLIC_KEY?: string;
  readonly VAPID_PRIVATE_KEY?: string;
}

export interface Notifier {
  readonly db: D1Database;
  readonly queue: Queue<NotificationMessage>;
  readonly publicKey: string;
}

/** What sending notifications takes, or nothing when the instance has not set it up. */
export function notifierOf(env: NotificationEnv): Notifier | undefined {
  const { DB: db, NOTIFICATIONS: queue, VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = env;
  return queue === undefined || publicKey === undefined || publicKey === '' || privateKey === undefined || privateKey === ''
    ? undefined
    : { db, queue, publicKey };
}

/** Most subscriptions a group keeps: far above a group's phones, it bounds what a leaked link can make the server send for each change. */
export const MAX_GROUP_SUBSCRIPTIONS = 200;

/** Saves the subscription of a phone as the member it says it is, or moves it to that member; refused when the group already holds the most. */
export async function saveSubscription(db: D1Database, groupId: GroupId, request: SubscribeRequest): Promise<'saved' | 'unknown_member' | 'full'> {
  const member = await db.prepare('SELECT 1 FROM members WHERE group_id = ? AND id = ?').bind(groupId, request.member).first();
  if (member === null) {
    return 'unknown_member';
  }
  const { endpoint, keys } = request.subscription;
  // The count lives in the statement, so that concurrent subscriptions cannot go past the limit together.
  const result = await db
    .prepare(
      `INSERT INTO subscriptions (group_id, endpoint, member_id, p256dh, auth)
       SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM subscriptions WHERE group_id = ? AND endpoint <> ?) < ?
       ON CONFLICT (group_id, endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    )
    .bind(groupId, endpoint, request.member, keys.p256dh, keys.auth, groupId, endpoint, MAX_GROUP_SUBSCRIPTIONS)
    .run();
  return result.meta.changes === 1 ? 'saved' : 'full';
}

/** Stops the subscription of a phone to the group; nothing to do when there is none. */
export async function deleteSubscription(db: D1Database, groupId: GroupId, endpoint: string): Promise<void> {
  await db.prepare('DELETE FROM subscriptions WHERE group_id = ? AND endpoint = ?').bind(groupId, endpoint).run();
}

interface SubscriptionRow {
  readonly endpoint: string;
  readonly member: string;
  readonly p256dh: string;
  readonly auth: string;
}

function messageTo(row: SubscriptionRow, groupId: GroupId, subject: string, message: NotificationMessage['message']): NotificationMessage {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
    groupId,
    member: memberIdSchema.parse(row.member),
    subject,
    message,
  };
}

/** Queues a test notification to one subscription of the group; false when the group has no subscription behind the endpoint. */
export async function queueTest(notifier: Notifier, groupId: GroupId, endpoint: string, subject: string): Promise<boolean> {
  const row = await notifier.db
    .prepare('SELECT endpoint, member_id AS member, p256dh, auth FROM subscriptions WHERE group_id = ? AND endpoint = ?')
    .bind(groupId, endpoint)
    .first<SubscriptionRow>();
  if (row === null) {
    return false;
  }
  await notifier.queue.send(messageTo(row, groupId, subject, { type: 'test', groupId }));
  return true;
}

// Limits of one `sendBatch` (Queues limits: 100 messages, 256 KB in all), the bytes with a margin for what the queue adds to each message.
const MAX_SEND_MESSAGES = 100;
const MAX_SEND_BYTES = 200_000;

/** Splits the messages into the batches `sendBatch` takes, in order. */
export function sendBatches(messages: readonly NotificationMessage[]): NotificationMessage[][] {
  const batches: NotificationMessage[][] = [];
  let bytes = 0;
  for (const message of messages) {
    const size = new TextEncoder().encode(JSON.stringify(message)).byteLength;
    const last = batches.at(-1);
    if (last === undefined || last.length === MAX_SEND_MESSAGES || bytes + size > MAX_SEND_BYTES) {
      batches.push([message]);
      bytes = size;
    } else {
      last.push(message);
      bytes += size;
    }
  }
  return batches;
}

// Content written by the server after `operationSchema`, parsed again all the same: a notification is never worth a wrong read.
const parseOperation = (content: string): Operation => operationSchema.parse(JSON.parse(content));

/**
 * Queues one message to each phone of each member the revisions just written concern (`noticesByMember`), and returns how many. Reads the
 * revisions back from the database, with the version of each operation before them, so that the request that wrote them answers first.
 */
export async function queueNotifications(notifier: Notifier, groupId: GroupId, revisionIds: readonly RevisionId[], subject: string): Promise<number> {
  const { db } = notifier;
  const { results: writtenRows } = await db
    .prepare(`SELECT seq, content FROM revisions WHERE group_id = ? AND revision_id IN (SELECT value FROM json_each(?)) ORDER BY seq`)
    .bind(groupId, JSON.stringify(revisionIds))
    .all<{ seq: number; content: string }>();
  const written = writtenRows.map((row) => parseOperation(row.content));
  const firstSeq = writtenRows[0]?.seq;
  if (firstSeq === undefined || written.every((operation) => operation.author === undefined)) {
    return 0;
  }
  // SQLite takes the bare column `content` from the row of `MAX(seq)`: the last revision of each operation before the batch.
  const { results: previousRows } = await db
    .prepare(
      `SELECT content, MAX(seq) FROM revisions WHERE group_id = ? AND operation_id IN (SELECT value FROM json_each(?)) AND seq < ? GROUP BY operation_id`,
    )
    .bind(groupId, JSON.stringify([...new Set(written.map((operation) => operation.id))]), firstSeq)
    .all<{ content: string }>();
  const previous = new Map<OperationId, Operation>(
    previousRows.map((row) => parseOperation(row.content)).map((operation) => [operation.id, operation]),
  );
  const notices = noticesByMember(previous, written);
  if (notices.size === 0) {
    return 0;
  }
  const [{ results: subscriptionRows }, { results: memberRows }] = await Promise.all([
    db
      .prepare(
        'SELECT endpoint, member_id AS member, p256dh, auth FROM subscriptions WHERE group_id = ? AND member_id IN (SELECT value FROM json_each(?))',
      )
      .bind(groupId, JSON.stringify([...notices.keys()]))
      .all<SubscriptionRow>(),
    db.prepare('SELECT id, name FROM members WHERE group_id = ?').bind(groupId).all<{ id: string; name: string }>(),
  ]);
  const names = new Map(memberRows.map((row) => [row.id, row.name]));
  const phones = Map.groupBy(subscriptionRows, (row) => row.member);
  const messages = [...notices].flatMap(([member, memberNotices]) =>
    (phones.get(member) ?? []).map((row) =>
      messageTo(row, groupId, subject, {
        type: 'operations',
        groupId,
        count: memberNotices.length,
        // The id stands in for a name the group no longer has, which the server never lets happen: an author is checked against the members.
        notices: memberNotices.slice(0, MAX_PUSH_NOTICES).map((notice) => ({ ...notice, authorName: names.get(notice.author) ?? notice.author })),
      }),
    ),
  );
  for (const batch of sendBatches(messages)) {
    await notifier.queue.sendBatch(batch.map((body) => ({ body })));
  }
  return messages.length;
}

/** Writes one line to the Worker's logs, which `wrangler tail` shows. */
export function log(line: Readonly<Record<string, unknown>>): void {
  // eslint-disable-next-line no-console -- the console is where a Worker's logs go.
  console.log(JSON.stringify(line));
}

/** Sends a request: `fetch`, played by the tests. */
export type Send = (endpoint: string, init: RequestInit) => Promise<Response>;

type Outcome = 'sent' | 'gone' | 'refused' | 'retry' | 'invalid';

async function deliver(
  body: unknown,
  env: NotificationEnv,
  send: Send,
): Promise<{ outcome: Outcome; status?: number; message?: NotificationMessage }> {
  const parsed = notificationMessageSchema.safeParse(body);
  if (!parsed.success || env.VAPID_PUBLIC_KEY === undefined || env.VAPID_PRIVATE_KEY === undefined) {
    return { outcome: 'invalid' };
  }
  const message = parsed.data;
  const vapid = { subject: message.subject, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  let response: Response;
  try {
    // A day, then the push service drops it: a phone off for longer catches up when the app opens.
    const payload = await buildPushPayload(
      { data: message.message, options: { ttl: 86_400, urgency: 'normal' } },
      { endpoint: message.endpoint, expirationTime: null, keys: message.keys },
      vapid,
    );
    response = await send(message.endpoint, payload);
  } catch {
    // The push service out of reach; a key the encryption refuses would fail again just the same, but cannot come from a validated subscription.
    return { outcome: 'retry', message };
  }
  const { status } = response;
  if (status === 404 || status === 410) {
    // The phone gave up the subscription (app removed, permission withdrawn): every group it was subscribed to forgets it.
    await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(message.endpoint).run();
    return { outcome: 'gone', status, message };
  }
  if (status === 429 || status >= 500) {
    return { outcome: 'retry', status, message };
  }
  return { outcome: status >= 200 && status < 300 ? 'sent' : 'refused', status, message };
}

/** Consumer of the queue: encrypts and sends each message, forgets the subscriptions their push service says are gone, retries later on a failure of the service. */
export async function deliverBatch(batch: MessageBatch, env: NotificationEnv, send: Send): Promise<void> {
  for (const queued of batch.messages) {
    const { outcome, status, message } = await deliver(queued.body, env, send);
    // What `wrangler tail` shows of each push: neither the endpoint, which lets anyone send to the phone, nor the content.
    log({ notification: outcome, status, group: message?.groupId, member: message?.member, attempt: queued.attempts });
    if (outcome === 'retry') {
      queued.retry({ delaySeconds: 30 });
    } else {
      queued.ack();
    }
  }
}
