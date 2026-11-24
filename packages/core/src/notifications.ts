import { z } from 'zod';

import { memberNameSchema } from './group.ts';
import { groupIdSchema, type MemberId, memberIdSchema, type OperationId, operationIdSchema } from './ids.ts';
import { type Operation, operationEffect, operationTitleSchema } from './operation.ts';

/** What a revision did to its operation, from the point of view of a member who sees the operation in the list. */
export const noticeKindSchema = z.enum(['added', 'changed', 'deleted']);
export type NoticeKind = z.infer<typeof noticeKindSchema>;

/** One operation a notification tells about: what happened to it, its title in the revision, and who entered the revision. */
export const noticeSchema = z.strictObject({
  kind: noticeKindSchema,
  operationId: operationIdSchema,
  title: operationTitleSchema,
  author: memberIdSchema,
});
export type Notice = z.infer<typeof noticeSchema>;

// Members a version of an operation affects: its payer and every member with a non-zero share (wider than “involved”); none for a deletion.
function affectedMembers(operation: Operation | undefined): MemberId[] {
  const effect = operation === undefined ? undefined : operationEffect(operation);
  return effect === undefined ? [] : [effect.payer, ...effect.shares.map((share) => share.member)];
}

const lives = (version: Operation | undefined) => version !== undefined && !('deleted' in version);

// What one member is told about an operation the batch wrote: the revisions entered by others than them, from the version just before the first of
// them to the last of them, when one of these two versions affects them.
function noticeFor(member: MemberId, versions: readonly [Operation | undefined, ...Operation[]]): Notice | undefined {
  const byOthers = (version: Operation | undefined, index: number) => index > 0 && version?.author !== undefined && version.author !== member;
  const first = versions.findIndex(byOthers);
  const before = versions[first - 1];
  const after = versions[versions.findLastIndex(byOthers)];
  if (first === -1 || after?.author === undefined) {
    return undefined;
  }
  if (!affectedMembers(before).includes(member) && !affectedMembers(after).includes(member)) {
    return undefined;
  }
  // A deletion affects no one: told about only by a member the version before it affected, who saw it live.
  const kind = 'deleted' in after ? 'deleted' : lives(before) ? 'changed' : 'added';
  return { kind, operationId: after.id, title: after.title, author: after.author };
}

/**
 * Notices of each member about the revisions written by one batch, one per operation, in the order first written: a member is told about an
 * operation when it affects them (payer or non-zero share) before or after the revisions others entered in the batch, which `noticeFor` details.
 * `previous` holds the version of each operation before the batch. A revision without an author, which only an import writes, tells no one, so
 * that importing a group again does not notify every member of its whole history.
 */
export function noticesByMember(previous: ReadonlyMap<OperationId, Operation>, written: readonly Operation[]): Map<MemberId, Notice[]> {
  const revisions = Map.groupBy(written, (operation) => operation.id);
  const byMember = new Map<MemberId, Notice[]>();
  for (const [id, ofOperation] of revisions) {
    const versions = [previous.get(id), ...ofOperation] as const;
    // Added then deleted by the batch: whoever entered which revision, they came from one phone and nobody else saw any of them.
    if (!lives(versions[0]) && !lives(ofOperation.at(-1))) {
      continue;
    }
    for (const member of new Set(versions.flatMap(affectedMembers))) {
      const notice = noticeFor(member, versions);
      if (notice !== undefined) {
        byMember.set(member, [...(byMember.get(member) ?? []), notice]);
      }
    }
  }
  return byMember;
}

/** Most notices one push message carries, the server dropping more to fit its push size; `count` tells how many there were. */
export const MAX_PUSH_NOTICES = 5;

/**
 * What the service worker of a phone receives, encrypted for it alone: `test` when the person asked for a test notification, `operations` with the
 * first notices of a batch for the member the phone is subscribed as, each with the author's name at the time it was sent.
 */
export const pushMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('test'), groupId: groupIdSchema }),
  z
    .strictObject({
      type: z.literal('operations'),
      groupId: groupIdSchema,
      count: z.int().positive(),
      notices: z
        .array(noticeSchema.extend({ authorName: memberNameSchema }))
        .min(1)
        .max(MAX_PUSH_NOTICES),
    })
    .refine((message) => message.count >= message.notices.length, { message: 'count_below_notices', path: ['count'] }),
]);
export type PushMessage = z.infer<typeof pushMessageSchema>;

// Hosts of the push services of the browsers the app runs on (Chrome and the Android browsers on FCM, Firefox, Safari, Edge). The server sends
// to the endpoint a phone gives: any other address would let a holder of the link make the server send requests wherever they like.
const PUSH_SERVICE_HOSTS = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  // Zod runs the refinement even on a string `z.url()` refused; `URL.canParse` is too recent for Safari 16, where the app also runs.
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && PUSH_SERVICE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it; other fields are dropped. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(1000).refine(isPushServiceEndpoint, 'unknown_push_service'),
  keys: z.object({
    // The phone's public key (65 bytes) and its authentication secret (16 bytes), in base64url without padding.
    p256dh: z.base64url().length(87),
    auth: z.base64url().length(22),
  }),
});
export type PushSubscriptionJson = z.infer<typeof pushSubscriptionSchema>;

/** Body of the subscription of a phone to a group's notifications, as the member it says it is; sent again when that member changes. */
export const subscribeRequestSchema = z.strictObject({ member: memberIdSchema, subscription: pushSubscriptionSchema });
export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;

/** Answer to a subscription: the id of the group, which the push messages carry, so that the phone finds the group's link when one arrives. */
export const subscribeResponseSchema = z.strictObject({ groupId: groupIdSchema });
export type SubscribeResponse = z.infer<typeof subscribeResponseSchema>;

/** Body of the requests about one subscription of the group: stopping it, or sending it a test notification. */
export const endpointRequestSchema = z.strictObject({ endpoint: z.url().max(1000) });
export type EndpointRequest = z.infer<typeof endpointRequestSchema>;

/** The instance's public VAPID key, which the phone gives its push service when it subscribes. */
export const pushKeyResponseSchema = z.strictObject({ publicKey: z.base64url().length(87) });
export type PushKeyResponse = z.infer<typeof pushKeyResponseSchema>;
