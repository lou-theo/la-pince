import {
  adminGroupSchema,
  type ApiError,
  changesQuerySchema,
  type ChangesResponse,
  endpointRequestSchema,
  type GroupId,
  groupIdSchema,
  type GroupResponse,
  groupUpdateSchema,
  isAcceptedPhoto,
  MAX_BATCH_REVISIONS,
  MAX_PHOTO_BYTES,
  type MemberId,
  memberIdSchema,
  memberUpdateSchema,
  newMemberSchema,
  type OperationBatchResponse,
  type PhotoChangeResponse,
  photoUndoSchema,
  photoVersionSchema,
  type PushKeyResponse,
  revisionIdSchema,
  subscribeRequestSchema,
  type SubscribeResponse,
} from '@la-pince/core';
import { and, asc, eq, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { addMember, readMembers, updateMember } from './members.ts';
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
import { type Changed, dropPhotos, type PhotoStore, readPhoto, removePhoto, setPhoto, undoPhoto } from './photos.ts';
import { groups, members, operations, revisions } from './schema.ts';
import { applyBatch } from './store.ts';

export interface Env extends NotificationEnv {
  /** Secret of the admin route; the route refuses everything when it is not set. */
  readonly ADMIN_TOKEN?: string;
  /** KV namespace of the members' photos; without it the instance keeps no photos (`photos_disabled`) and the group shows none. */
  readonly PHOTOS?: KVNamespace;
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

function apiError(context: AppContext, error: ApiError['error'], status: 400 | 401 | 404 | 409 | 503): Response {
  return context.json({ error } satisfies ApiError, status);
}

async function findGroup(context: AppContext): Promise<GroupId | undefined> {
  const tokenHash = await sha256(context.req.param('token') ?? '');
  const [group] = await drizzle(context.env.DB).select({ id: groups.id }).from(groups).where(eq(groups.tokenHash, tokenHash));
  return group === undefined ? undefined : groupIdSchema.parse(group.id);
}

async function readGroup(env: Env, groupId: GroupId): Promise<GroupResponse> {
  const db = drizzle(env.DB);
  const [group] = await db.select({ title: groups.title }).from(groups).where(eq(groups.id, groupId));
  const rows = await db
    .select({ id: members.id, name: members.name, photo: members.photo })
    .from(members)
    .where(eq(members.groupId, groupId))
    // Two members may share a position when the admin route and the app add one at the same time: the id settles the order the same way each time.
    .orderBy(asc(members.position), asc(members.id));
  // Read back from what the server wrote, which went through the same schemas. An instance whose KV binding was removed shows initials again
  // rather than photos it can no longer serve.
  const photos = env.PHOTOS !== undefined;
  return {
    title: group?.title ?? '',
    members: rows.map((row) => ({
      id: memberIdSchema.parse(row.id),
      name: row.name,
      ...(photos && row.photo !== null ? { photo: photoVersionSchema.parse(row.photo) } : {}),
    })),
    ...(photos ? { photos: true as const } : {}),
  };
}

const app = new Hono<{ Bindings: Env }>();

app.get('/api/groups/:token', async (context) => {
  const groupId = await findGroup(context);
  if (groupId === undefined) {
    return apiError(context, 'group_not_found', 404);
  }
  return context.json(await readGroup(context.env, groupId));
});

// The routes that edit the group answer with the whole group, as `GET` does, so that the phone shows what the server holds. The last write wins
// when two phones rename the same thing; neither an added member nor a renaming notifies anyone.
app.patch('/api/groups/:token', async (context) => {
  const update = groupUpdateSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!update.success) {
    return apiError(context, 'invalid_request', 400);
  }
  const groupId = await findGroup(context);
  if (groupId === undefined) {
    return apiError(context, 'group_not_found', 404);
  }
  const db = drizzle(context.env.DB);
  await db.update(groups).set({ title: update.data.title }).where(eq(groups.id, groupId));
  return context.json(await readGroup(context.env, groupId));
});

app.post('/api/groups/:token/members', async (context) => {
  const member = newMemberSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!member.success) {
    return apiError(context, 'invalid_request', 400);
  }
  const groupId = await findGroup(context);
  if (groupId === undefined) {
    return apiError(context, 'group_not_found', 404);
  }
  const outcome = await addMember(context.env.DB, groupId, member.data, await readMembers(context.env.DB, groupId));
  if (outcome === 'too_many_members' || outcome === 'member_name_taken') {
    return apiError(context, outcome, 409);
  }
  return context.json(await readGroup(context.env, groupId), outcome === 'added' ? 201 : 200);
});

app.patch('/api/groups/:token/members/:id', async (context) => {
  const memberId = memberIdSchema.safeParse(context.req.param('id'));
  const update = memberUpdateSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!memberId.success || !update.success) {
    return apiError(context, 'invalid_request', 400);
  }
  const groupId = await findGroup(context);
  if (groupId === undefined) {
    return apiError(context, 'group_not_found', 404);
  }
  const outcome = await updateMember(context.env.DB, groupId, memberId.data, update.data, await readMembers(context.env.DB, groupId));
  if (outcome === 'member_not_found') {
    return apiError(context, outcome, 404);
  }
  if (outcome === 'member_name_taken') {
    return apiError(context, outcome, 409);
  }
  return context.json(await readGroup(context.env, groupId));
});

// Photos of the members: bytes in KV under keys that never change, versions in D1 (`photos.ts`), which holds no image. KV may show a write elsewhere
// only up to a minute later, which a key that never changes turns into a missing photo for that while, never a stale one. Every route answers
// `photos_disabled` on an instance without the binding, and no answer but a photo is kept by a cache: a photo missing a moment ago may be there now.
const photoRoutes: MiddlewareHandler<{ Bindings: Env }> = (context, next) => {
  context.header('Cache-Control', 'no-store');
  return context.env.PHOTOS === undefined ? Promise.resolve(apiError(context, 'photos_disabled', 404)) : next();
};
app.use('/api/groups/:token/members/:id/photo', photoRoutes);
app.use('/api/groups/:token/members/:id/photo/*', photoRoutes);
app.use('/api/groups/:token/members/:id/photos/*', photoRoutes);

function photosOf(env: Env): PhotoStore {
  // Never taken: `photoRoutes` answers before any photo route on an instance without the binding.
  if (env.PHOTOS === undefined) {
    throw new Error('photo route reached without the PHOTOS binding');
  }
  return env.PHOTOS;
}

// Answers a photo change with the whole group, as the other routes that edit it do, and the undo of the change; then deletes the bytes no version
// points to any more.
const photoErrorStatus = { member_not_found: 404, photo_changed: 409, photos_unavailable: 503 } as const;
type PhotoError = keyof typeof photoErrorStatus;

async function answerPhotoChange(
  context: AppContext,
  groupId: GroupId,
  memberId: MemberId,
  changed: Changed<'set' | 'undone' | 'removed' | 'replayed' | PhotoError>,
): Promise<Response> {
  const { outcome, dropped, undo } = changed;
  if (outcome === 'member_not_found' || outcome === 'photo_changed' || outcome === 'photos_unavailable') {
    return apiError(context, outcome, photoErrorStatus[outcome]);
  }
  if (dropped.length > 0) {
    context.executionCtx.waitUntil(dropPhotos(context.env.DB, photosOf(context.env), groupId, memberId, dropped));
  }
  return context.json({ ...(await readGroup(context.env, groupId)), ...(undo === undefined ? {} : { undo }) } satisfies PhotoChangeResponse);
}

// The phone sends the JPEG it reduced, as is: a body of another type, too heavy or too wide only comes from a bug or a forged client.
app.put(
  '/api/groups/:token/members/:id/photo',
  bodyLimit({ maxSize: MAX_PHOTO_BYTES, onError: (context) => context.json({ error: 'invalid_request' } satisfies ApiError, 400) }),
  async (context) => {
    const memberId = memberIdSchema.safeParse(context.req.param('id'));
    const type = context.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase();
    if (!memberId.success || type !== 'image/jpeg') {
      return apiError(context, 'invalid_request', 400);
    }
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    if (!isAcceptedPhoto(bytes)) {
      return apiError(context, 'invalid_request', 400);
    }
    const groupId = await findGroup(context);
    if (groupId === undefined) {
      return apiError(context, 'group_not_found', 404);
    }
    return answerPhotoChange(context, groupId, memberId.data, await setPhoto(context.env.DB, photosOf(context.env), groupId, memberId.data, bytes));
  },
);

app.post('/api/groups/:token/members/:id/photo/undo', async (context) => {
  const memberId = memberIdSchema.safeParse(context.req.param('id'));
  const undo = photoUndoSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!memberId.success || !undo.success) {
    return apiError(context, 'invalid_request', 400);
  }
  const groupId = await findGroup(context);
  if (groupId === undefined) {
    return apiError(context, 'group_not_found', 404);
  }
  return answerPhotoChange(context, groupId, memberId.data, await undoPhoto(context.env.DB, groupId, memberId.data, undo.data));
});

app.delete('/api/groups/:token/members/:id/photo', async (context) => {
  const memberId = memberIdSchema.safeParse(context.req.param('id'));
  if (!memberId.success) {
    return apiError(context, 'invalid_request', 400);
  }
  const groupId = await findGroup(context);
  if (groupId === undefined) {
    return apiError(context, 'group_not_found', 404);
  }
  return answerPhotoChange(context, groupId, memberId.data, await removePhoto(context.env.DB, groupId, memberId.data));
});

// The address names the version, whose bytes never change: kept a year by the browser, `private` because the link's token is in the address.
app.get('/api/groups/:token/members/:id/photos/:version', async (context) => {
  const memberId = memberIdSchema.safeParse(context.req.param('id'));
  const version = photoVersionSchema.safeParse(context.req.param('version'));
  if (!memberId.success || !version.success) {
    return apiError(context, 'photo_not_found', 404);
  }
  const groupId = await findGroup(context);
  if (groupId === undefined) {
    return apiError(context, 'group_not_found', 404);
  }
  const bytes = await readPhoto(photosOf(context.env), groupId, memberId.data, version.data);
  if (bytes === null) {
    return apiError(context, 'photo_not_found', 404);
  }
  return context.body(bytes, 200, {
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
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
  return context.json(await readGroup(context.env, id));
});

export default {
  fetch: app.fetch,
  queue: (batch, env) => deliverBatch(batch, env, (endpoint, init) => fetch(endpoint, init)),
} satisfies ExportedHandler<Env>;
