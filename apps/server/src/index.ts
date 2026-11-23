import {
  adminGroupSchema,
  type ApiError,
  changesQuerySchema,
  type ChangesResponse,
  endpointRequestSchema,
  type GroupId,
  groupIdSchema,
  type GroupResponse,
  MAX_BATCH_REVISIONS,
  memberIdSchema,
  type OperationBatchResponse,
  type PushKeyResponse,
  revisionIdSchema,
  subscribeRequestSchema,
  type SubscribeResponse,
} from '@la-pince/core';
import { and, asc, eq, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import {
  deleteSubscription,
  deliverBatch,
  log,
  type NotificationEnv,
  notifierOf,
  queueNotifications,
  queueTest,
  saveSubscription,
} from './notifications.ts';
import { groups, members, operations, revisions } from './schema.ts';
import { applyBatch } from './store.ts';

export interface Env extends NotificationEnv {
  /** Secret of the admin route; the route refuses everything when it is not set. */
  readonly ADMIN_TOKEN?: string;
}

type AppContext = Context<{ Bindings: Env }>;

// The envelope only: each revision is then judged on its own, so that one the server refuses never blocks the outbox. A revision without a readable
// id cannot be answered, which only a bug of the client produces: the whole batch is refused.
const batchEnvelopeSchema = z.strictObject({
  operations: z
    .array(z.looseObject({ revisionId: revisionIdSchema }))
    .min(1)
    .max(MAX_BATCH_REVISIONS),
});

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function apiError(context: AppContext, error: ApiError['error'], status: 400 | 401 | 404 | 409): Response {
  return context.json({ error } satisfies ApiError, status);
}

async function findGroup(context: AppContext): Promise<GroupId | undefined> {
  const tokenHash = await sha256(context.req.param('token') ?? '');
  const [group] = await drizzle(context.env.DB).select({ id: groups.id }).from(groups).where(eq(groups.tokenHash, tokenHash));
  return group === undefined ? undefined : groupIdSchema.parse(group.id);
}

async function readGroup(db: ReturnType<typeof drizzle>, groupId: GroupId): Promise<GroupResponse> {
  const [group] = await db.select({ title: groups.title }).from(groups).where(eq(groups.id, groupId));
  const rows = await db
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(eq(members.groupId, groupId))
    .orderBy(asc(members.position));
  // Read back from what the server wrote, which went through the same schemas.
  return { title: group?.title ?? '', members: rows.map((row) => ({ id: memberIdSchema.parse(row.id), name: row.name })) };
}

const app = new Hono<{ Bindings: Env }>();

app.get('/api/groups/:token', async (context) => {
  const groupId = await findGroup(context);
  if (groupId === undefined) {
    return apiError(context, 'group_not_found', 404);
  }
  return context.json(await readGroup(drizzle(context.env.DB), groupId));
});

app.get('/api/groups/:token/changes', async (context) => {
  const query = changesQuerySchema.safeParse(context.req.query());
  if (!query.success) {
    return apiError(context, 'invalid_request', 400);
  }
  const groupId = await findGroup(context);
  if (groupId === undefined) {
    return apiError(context, 'group_not_found', 404);
  }
  const db = drizzle(context.env.DB);
  const { since, revision, limit } = query.data;
  if (revision !== undefined) {
    // After a restore, the seq of the cursor may be gone, or given again to another revision.
    const [atCursor] = await db
      .select({ seq: revisions.seq })
      .from(revisions)
      .where(and(eq(revisions.seq, since), eq(revisions.revisionId, revision), eq(revisions.groupId, groupId)));
    if (atCursor === undefined) {
      return apiError(context, 'unknown_cursor', 409);
    }
  }
  // One row more than asked tells whether another page is waiting.
  const rows = await db
    .select({ seq: operations.seq, createdSeq: operations.createdSeq, content: operations.content })
    .from(operations)
    .where(and(eq(operations.groupId, groupId), gt(operations.seq, since)))
    .orderBy(asc(operations.seq))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const response = {
    // Content written by the server after `operationSchema`: read back as is.
    changes: page.map((row) => ({ ...(JSON.parse(row.content) as object), seq: row.seq, createdSeq: row.createdSeq })),
    cursor: page.at(-1)?.seq ?? since,
    hasMore: rows.length > limit,
  };
  return context.json(response as ChangesResponse);
});

app.post('/api/groups/:token/operations', async (context) => {
  const body: unknown = await context.req.json().catch(() => undefined);
  const envelope = batchEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    return apiError(context, 'invalid_request', 400);
  }
  const groupId = await findGroup(context);
  if (groupId === undefined) {
    return apiError(context, 'group_not_found', 404);
  }
  const response: OperationBatchResponse = {
    results: await applyBatch(
      context.env.DB,
      groupId,
      envelope.data.operations.map((raw) => ({ revisionId: raw.revisionId, raw })),
    ),
  };
  const notifier = notifierOf(context.env);
  const written = response.results.flatMap((result) => (result.status === 'written' ? [result.revisionId] : []));
  if (notifier !== undefined && written.length > 0) {
    // After the answer: a notification never delays nor fails the write.
    context.executionCtx.waitUntil(
      queueNotifications(notifier, groupId, written, new URL(context.req.url).origin).catch((error: unknown) => {
        log({ notification: 'not_queued', group: groupId, error: String(error) });
      }),
    );
  }
  return context.json(response);
});

app.get('/api/notifications/key', (context) => {
  const notifier = notifierOf(context.env);
  if (notifier === undefined) {
    return apiError(context, 'notifications_disabled', 404);
  }
  return context.json({ publicKey: notifier.publicKey } satisfies PushKeyResponse);
});

app.put('/api/groups/:token/subscription', async (context) => {
  const request = subscribeRequestSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!request.success) {
    return apiError(context, 'invalid_request', 400);
  }
  const groupId = await findGroup(context);
  if (groupId === undefined) {
    return apiError(context, 'group_not_found', 404);
  }
  if (notifierOf(context.env) === undefined) {
    return apiError(context, 'notifications_disabled', 404);
  }
  const saved = await saveSubscription(context.env.DB, groupId, request.data);
  if (saved === 'unknown_member') {
    return apiError(context, 'invalid_request', 400);
  }
  return saved === 'full' ? apiError(context, 'too_many_subscriptions', 409) : context.json({ groupId } satisfies SubscribeResponse);
});

// Open even when the instance has no notifications: a phone can always stop a subscription it holds.
app.delete('/api/groups/:token/subscription', async (context) => {
  const request = endpointRequestSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!request.success) {
    return apiError(context, 'invalid_request', 400);
  }
  const groupId = await findGroup(context);
  if (groupId === undefined) {
    return apiError(context, 'group_not_found', 404);
  }
  await deleteSubscription(context.env.DB, groupId, request.data.endpoint);
  return context.body(null, 204);
});

app.post('/api/groups/:token/subscription/test', async (context) => {
  const request = endpointRequestSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!request.success) {
    return apiError(context, 'invalid_request', 400);
  }
  const groupId = await findGroup(context);
  if (groupId === undefined) {
    return apiError(context, 'group_not_found', 404);
  }
  const notifier = notifierOf(context.env);
  if (notifier === undefined) {
    return apiError(context, 'notifications_disabled', 404);
  }
  const queued = await queueTest(notifier, groupId, request.data.endpoint, new URL(context.req.url).origin);
  return queued ? context.body(null, 202) : apiError(context, 'subscription_not_found', 404);
});

app.put('/api/admin/groups/:id', async (context) => {
  const expected = context.env.ADMIN_TOKEN;
  const given = context.req.header('Authorization')?.replace(/^Bearer /, '');
  // Hashes compared rather than the secrets, so that the comparison time tells nothing about the token.
  if (expected === undefined || expected === '' || given === undefined || (await sha256(given)) !== (await sha256(expected))) {
    return apiError(context, 'unauthorized', 401);
  }
  const groupId = groupIdSchema.safeParse(context.req.param('id'));
  const body: unknown = await context.req.json().catch(() => undefined);
  const group = adminGroupSchema.safeParse(body);
  if (!groupId.success || !group.success) {
    return apiError(context, 'invalid_request', 400);
  }
  const db = drizzle(context.env.DB);
  const id = groupId.data;
  const existing = await db.select({ id: members.id, position: members.position }).from(members).where(eq(members.groupId, id));
  const positions = new Map(existing.map((row) => [row.id, row.position]));
  let next = Math.max(-1, ...positions.values()) + 1;
  const tokenHash = await sha256(group.data.token);
  const [holder] = await db.select({ id: groups.id }).from(groups).where(eq(groups.tokenHash, tokenHash));
  if (holder !== undefined && holder.id !== id) {
    return apiError(context, 'token_in_use', 409);
  }
  await db.batch([
    db
      .insert(groups)
      .values({ id, tokenHash, title: group.data.title })
      .onConflictDoUpdate({ target: groups.id, set: { tokenHash, title: group.data.title } }),
    ...group.data.members.map((member) =>
      db
        .insert(members)
        .values({ groupId: id, id: member.id, name: member.name, position: positions.get(member.id) ?? next++ })
        .onConflictDoUpdate({ target: [members.groupId, members.id], set: { name: member.name } }),
    ),
  ]);
  return context.json(await readGroup(db, id));
});

export default {
  fetch: app.fetch,
  queue: (batch, env) => deliverBatch(batch, env, (endpoint, init) => fetch(endpoint, init)),
} satisfies ExportedHandler<Env>;
