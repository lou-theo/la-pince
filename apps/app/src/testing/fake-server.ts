import {
  type ApiError,
  type Change,
  changeSchema,
  changesQuerySchema,
  changesResponseSchema,
  type GroupResponse,
  groupResponseSchema,
  groupUpdateSchema,
  isAcceptedPhoto,
  MAX_GROUP_MEMBERS,
  memberNameKey,
  memberUpdateSchema,
  newMemberSchema,
  operationBatchResponseSchema,
  operationBatchSchema,
  type PhotoChangeResponse,
  type PhotoUndo,
  photoUndoSchema,
  type PhotoVersion,
  photoVersionSchema,
  type RevisionResult,
  unknownMembers,
} from '@la-pince/core';

import type { Fetch } from '../sync/client.ts';

// Test helpers: a fake transport answering as `apps/server` does, every answer built through the schemas of the core.

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export interface FakeServer {
  readonly fetch: Fetch;
  /** URLs asked, in order. */
  readonly calls: string[];
  /** The group as served now, photos included. */
  readonly group: () => GroupResponse;
}

/** Version of a photo as the server draws it: the first 16 bytes of the SHA-256 of its bytes, in base64url. */
export async function photoVersionOf(bytes: Uint8Array<ArrayBuffer>): Promise<PhotoVersion> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes), 0, 16);
  return photoVersionSchema.parse(
    btoa(String.fromCharCode(...digest))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, ''),
  );
}

/**
 * Serves one group under its token, its changes by pages of `pageSize` (`unknown_cursor` when no change has the revision named at the cursor), and writes the revisions sent into `changes` (a resent revision is a
 * duplicate, one naming a stranger is rejected); renames the group, adds and renames its members, sets, removes and undoes their photos as the
 * server does (`photos_disabled` unless the group says `photos`); `answer` may replace the answer to a URL (failure, odd page).
 */
export function fakeServer({
  token,
  group,
  changes = [],
  pageSize = 500,
  answer,
}: {
  token: string;
  group: GroupResponse;
  changes?: Change[];
  pageSize?: number;
  answer?: (url: string) => Promise<Response> | undefined;
}): FakeServer {
  const calls: string[] = [];
  const base = `/api/groups/${token}`;
  let served = group;
  const bodyOf = (init: RequestInit | undefined): unknown => JSON.parse(typeof init?.body === 'string' ? init.body : 'null');
  const error = (code: ApiError['error'], status: number) => Promise.resolve(json({ error: code } satisfies ApiError, status));
  const nameTaken = (name: string, self: string) =>
    served.members.some((member) => member.id !== self && memberNameKey(member.name) === memberNameKey(name));
  const answerGroup = (status = 200) => Promise.resolve(json(groupResponseSchema.parse(served), status));
  // Versions each member points to, the photo and the one before it, and the bytes of each version kept, by member and version.
  const previous = new Map<string, PhotoVersion | null>();
  const bytes = new Map<string, Uint8Array<ArrayBuffer>>();
  const photoOf = (id: string): PhotoVersion | null => served.members.find((member) => member.id === id)?.photo ?? null;
  const point = (id: string, photo: PhotoVersion | null, before: PhotoVersion | null) => {
    previous.set(id, before);
    served = {
      ...served,
      members: served.members.map((member) => {
        if (member.id !== id) {
          return member;
        }
        const rest = { id: member.id, name: member.name };
        return photo === null ? rest : { ...rest, photo };
      }),
    };
  };
  const answerPhoto = (undo: PhotoUndo | undefined) =>
    Promise.resolve(json({ ...groupResponseSchema.parse(served), ...(undo === undefined ? {} : { undo }) } satisfies PhotoChangeResponse));
  const photoRoute = async (url: string, init: RequestInit | undefined): Promise<Response> => {
    const [, id = '', rest = ''] = /^\/members\/([^/]+)\/(.*)$/.exec(url.slice(base.length)) ?? [];
    const member = decodeURIComponent(id);
    if (served.photos !== true) {
      return json({ error: 'photos_disabled' } satisfies ApiError, 404);
    }
    if (rest.startsWith('photos/')) {
      const kept = bytes.get(`${member}/${rest.slice('photos/'.length)}`);
      return kept === undefined
        ? json({ error: 'photo_not_found' } satisfies ApiError, 404)
        : new Response(kept.slice(), { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (!served.members.some((candidate) => candidate.id === member)) {
      return json({ error: 'member_not_found' } satisfies ApiError, 404);
    }
    const now = photoOf(member);
    const before = previous.get(member) ?? null;
    if (rest === 'photo' && init?.method === 'PUT') {
      const body = new Uint8Array(init.body instanceof Blob ? await init.body.arrayBuffer() : new ArrayBuffer(0));
      if (!isAcceptedPhoto(body)) {
        return json({ error: 'invalid_request' } satisfies ApiError, 400);
      }
      const version = await photoVersionOf(body);
      bytes.set(`${member}/${version}`, body);
      if (now === version) {
        return answerPhoto({ version, previous: before });
      }
      point(member, version, now);
      return answerPhoto({ version, previous: now });
    }
    if (rest === 'photo' && init?.method === 'DELETE') {
      if (now === null) {
        return answerPhoto(before === null ? undefined : { version: null, previous: before });
      }
      point(member, null, now);
      return answerPhoto({ version: null, previous: now });
    }
    const undo = photoUndoSchema.safeParse(bodyOf(init));
    if (rest !== 'photo/undo' || !undo.success) {
      return json({ error: 'invalid_request' } satisfies ApiError, 400);
    }
    if (now === undo.data.version && before === undo.data.previous) {
      point(member, undo.data.previous, undo.data.version);
      return answerPhoto({ version: undo.data.previous, previous: undo.data.version });
    }
    return now === undo.data.previous ? answerPhoto(undefined) : json({ error: 'photo_changed' } satisfies ApiError, 409);
  };
  return {
    calls,
    group: () => served,
    fetch: (url, init) => {
      calls.push(url);
      const replaced = answer?.(url);
      if (replaced !== undefined) {
        return replaced;
      }
      if (/^\/members\/[^/]+\/photos?(\/|$)/.test(url.slice(base.length)) && url.startsWith(base)) {
        return photoRoute(url, init);
      }
      if (url === base && init?.method === 'PATCH') {
        const update = groupUpdateSchema.safeParse(bodyOf(init));
        if (!update.success) {
          return error('invalid_request', 400);
        }
        served = { ...served, title: update.data.title };
        return answerGroup();
      }
      if (url === base) {
        return answerGroup();
      }
      if (url === `${base}/members` && init?.method === 'POST') {
        const member = newMemberSchema.safeParse(bodyOf(init));
        if (!member.success) {
          return error('invalid_request', 400);
        }
        if (served.members.some(({ id }) => id === member.data.id)) {
          return answerGroup();
        }
        if (served.members.length >= MAX_GROUP_MEMBERS) {
          return error('too_many_members', 409);
        }
        if (nameTaken(member.data.name, member.data.id)) {
          return error('member_name_taken', 409);
        }
        served = { ...served, members: [...served.members, member.data] };
        return answerGroup(201);
      }
      if (url.startsWith(`${base}/members/`) && init?.method === 'PATCH') {
        const id = decodeURIComponent(url.slice(`${base}/members/`.length));
        const update = memberUpdateSchema.safeParse(bodyOf(init));
        if (!update.success) {
          return error('invalid_request', 400);
        }
        if (!served.members.some((member) => member.id === id)) {
          return error('member_not_found', 404);
        }
        const { name } = update.data;
        if (name !== undefined && nameTaken(name, id)) {
          return error('member_name_taken', 409);
        }
        served = { ...served, members: served.members.map((member) => (member.id === id ? { ...member, name: name ?? member.name } : member)) };
        return answerGroup();
      }
      if (url === `${base}/operations` && init?.method === 'POST') {
        const batch = operationBatchSchema.parse(JSON.parse(typeof init.body === 'string' ? init.body : ''));
        const members = new Set(served.members.map((member) => member.id));
        const results = batch.operations.map((operation): RevisionResult => {
          if (changes.some((current) => current.revisionId === operation.revisionId)) {
            return { revisionId: operation.revisionId, status: 'duplicate' };
          }
          if (unknownMembers(operation, members).length > 0) {
            return { revisionId: operation.revisionId, status: 'rejected', reason: 'unknown_member' };
          }
          seq += 1;
          const createdSeq = changes.find((current) => current.id === operation.id)?.createdSeq ?? seq;
          changes.push(changeSchema.parse({ ...operation, seq, createdSeq }));
          return { revisionId: operation.revisionId, status: 'written', seq };
        });
        return Promise.resolve(json(operationBatchResponseSchema.parse({ results })));
      }
      const [path, search = ''] = url.split('?');
      if (path !== `${base}/changes`) {
        return Promise.resolve(json({ error: 'group_not_found' } satisfies ApiError, 404));
      }
      const query = changesQuerySchema.safeParse(Object.fromEntries(new URLSearchParams(search)));
      if (!query.success) {
        return Promise.resolve(json({ error: 'invalid_request' } satisfies ApiError, 400));
      }
      const { since, revision } = query.data;
      if (revision !== undefined && !changes.some((candidate) => candidate.seq === since && candidate.revisionId === revision)) {
        return Promise.resolve(json({ error: 'unknown_cursor' } satisfies ApiError, 409));
      }
      const after = changes.filter((candidate) => candidate.seq > since).toSorted((a, b) => a.seq - b.seq);
      const page = after.slice(0, pageSize);
      return Promise.resolve(
        json(changesResponseSchema.parse({ changes: page, cursor: page.at(-1)?.seq ?? since, hasMore: after.length > pageSize })),
      );
    },
  };
}

let seq = 0;

/** A change of the fake server: an expense paid by `payer` with fixed amounts, a reimbursement, or a deletion; seqs grow with each call. */
export function change(fields: {
  id: string;
  date: string;
  title?: string;
  createdSeq?: number;
  payer?: string;
  lines?: readonly (readonly [string, number])[];
  kind?: 'expense' | 'reimbursement';
  author?: string;
  deleted?: boolean;
}): Change {
  seq += 1;
  const base = {
    id: fields.id,
    revisionId: `rev-${String(seq)}`,
    title: fields.title ?? `Opération ${fields.id}`,
    date: fields.date,
    seq,
    createdSeq: fields.createdSeq ?? seq,
    ...(fields.author === undefined ? {} : { author: fields.author }),
  };
  if (fields.deleted === true) {
    return changeSchema.parse({ ...base, deleted: true });
  }
  const lines = (fields.lines ?? [['m1', 1_000]]).map(([member, amount]) => ({ member, amount }));
  return changeSchema.parse({ ...base, entry: { version: 1, kind: fields.kind ?? 'expense', payer: fields.payer ?? 'm1', lines } });
}
