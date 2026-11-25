import { type GroupId, type MemberId, type PhotoUndo, type PhotoVersion, photoVersionSchema } from '@la-pince/core';

import { log } from './notifications.ts';
import { toBase64Url } from './vapid.ts';

/** What the Worker needs of its KV namespace of photos (binding `PHOTOS`), so that a test can give a store that fails. */
export interface PhotoStore {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  delete(key: string): Promise<void>;
}

/** Versions a member points to: the photo shown, and the one before it, kept so that an undo can put it back. */
export interface PhotoState {
  readonly photo: PhotoVersion | null;
  readonly previous: PhotoVersion | null;
}

// The group in the key lets a later move to another store copy a group by listing its prefix; the member keeps two members from sharing a key.
const keyOf = (groupId: GroupId, memberId: MemberId, version: PhotoVersion) => `photo/${groupId}/${memberId}/${version}`;

/** The version of a photo: the first 16 bytes of the SHA-256 of its bytes, in base64url. */
export async function photoVersion(bytes: Uint8Array): Promise<PhotoVersion> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return photoVersionSchema.parse(toBase64Url(new Uint8Array(digest, 0, 16)));
}

const nullableVersion = photoVersionSchema.nullable();

async function readPhotos(db: D1Database, groupId: GroupId, memberId: MemberId): Promise<PhotoState | undefined> {
  const row = await db
    .prepare('SELECT photo, previous_photo FROM members WHERE group_id = ? AND id = ?')
    .bind(groupId, memberId)
    .first<{ photo: string | null; previous_photo: string | null }>();
  return row === null ? undefined : { photo: nullableVersion.parse(row.photo), previous: nullableVersion.parse(row.previous_photo) };
}

// Each try lost means another change of the same member's photo was written in between, so tries run out only under a flood of changes.
const MAX_TRIES = 10;

interface Judgment<Outcome> {
  readonly outcome: Outcome;
  /** The versions to write, or nothing to write. */
  readonly to?: PhotoState;
}

/** Outcome of a change, with the versions no longer pointed to, whose bytes `dropPhotos` deletes once the answer is sent. */
export interface Changed<Outcome> {
  readonly outcome: Outcome | 'member_not_found';
  readonly dropped: readonly PhotoVersion[];
}

/**
 * Writes what `judge` decides on the member's versions (read first, unless `read` gives them), only if they have not changed since they were read
 * (the same guard as `members.ts`), and judges again on a fresh read otherwise. D1 runs a database's statements one after the other: two changes
 * never both pass on the same read.
 */
async function change<Outcome>(
  db: D1Database,
  groupId: GroupId,
  memberId: MemberId,
  judge: (current: PhotoState) => Judgment<Outcome>,
  read?: PhotoState,
): Promise<Changed<Outcome>> {
  let given = read;
  for (let tries = 0; ; tries += 1) {
    const current = given ?? (await readPhotos(db, groupId, memberId));
    given = undefined;
    if (current === undefined) {
      return { outcome: 'member_not_found', dropped: [] };
    }
    const { outcome, to } = judge(current);
    if (to === undefined) {
      return { outcome, dropped: [] };
    }
    // Only under a flood of changes of the same photo.
    /* v8 ignore next 3 */
    if (tries === MAX_TRIES) {
      throw new Error('photo not changed: it changed at each try');
    }
    const written = await db
      .prepare(
        `UPDATE members SET photo = ?3, previous_photo = ?4
         WHERE group_id = ?1 AND id = ?2 AND photo IS ?5 AND previous_photo IS ?6 RETURNING id`,
      )
      .bind(groupId, memberId, to.photo, to.previous, current.photo, current.previous)
      .first();
    if (written !== null) {
      const kept = [to.photo, to.previous];
      return {
        outcome,
        dropped: [current.photo, current.previous].filter((version): version is PhotoVersion => version !== null && !kept.includes(version)),
      };
    }
  }
}

/**
 * Makes `bytes` the member's photo, the photo before it becoming the one an undo puts back. The same bytes sent again while they are the photo and
 * stored are a replay: nothing is written, which also keeps clear of KV's limit of one write per second on a key; bytes lost meanwhile (a database
 * restored, a deletion crossing this photo set again) are written back. The bytes are stored before the versions point to them, so that a phone
 * never reads a version whose bytes were not written.
 */
export async function setPhoto(
  db: D1Database,
  store: PhotoStore,
  groupId: GroupId,
  memberId: MemberId,
  bytes: Uint8Array,
): Promise<Changed<'set' | 'replayed' | 'photos_unavailable'>> {
  const version = await photoVersion(bytes);
  const current = await readPhotos(db, groupId, memberId);
  if (current === undefined) {
    return { outcome: 'member_not_found', dropped: [] };
  }
  const key = keyOf(groupId, memberId, version);
  if (current.photo === version && (await store.get(key, 'arrayBuffer')) !== null) {
    return { outcome: 'replayed', dropped: [] };
  }
  try {
    await store.put(key, bytes);
  } catch (error) {
    // A key names its content: bytes already there are these bytes, written by the same photo sent twice at once, whose second write KV refuses
    // within the second. Otherwise the daily quota of writes of the free plan, or an outage.
    if ((await store.get(key, 'arrayBuffer')) === null) {
      log({ photo: 'not_stored', group: groupId, error: String(error) });
      return { outcome: 'photos_unavailable', dropped: [] };
    }
  }
  return change(
    db,
    groupId,
    memberId,
    (now) => (now.photo === version ? { outcome: 'replayed' } : { outcome: 'set', to: { photo: version, previous: now.photo } }),
    current,
  );
}

/**
 * Puts back the photo a change replaced, only while the photo it set is still the member's: a change made since by someone else is never undone
 * (`photo_changed`). An undo already done is a replay. Writes nothing to KV: the photo put back was kept since.
 */
export async function undoPhoto(
  db: D1Database,
  groupId: GroupId,
  memberId: MemberId,
  undo: PhotoUndo,
): Promise<Changed<'undone' | 'replayed' | 'photo_changed'>> {
  return change(db, groupId, memberId, (now) => {
    if (now.photo === undo.version && now.previous === undo.previous) {
      return { outcome: 'undone', to: { photo: undo.previous, previous: undo.version } };
    }
    return { outcome: now.photo === undo.previous ? 'replayed' : 'photo_changed' };
  });
}

/** Removes the member's photo, kept as the one an undo puts back. A member without a photo is left as it is. */
export async function removePhoto(db: D1Database, groupId: GroupId, memberId: MemberId): Promise<Changed<'removed' | 'replayed'>> {
  return change(db, groupId, memberId, (now) =>
    now.photo === null ? { outcome: 'replayed' } : { outcome: 'removed', to: { photo: null, previous: now.photo } },
  );
}

/** The bytes of a photo, or `null` when none is stored under that version. */
export async function readPhoto(store: PhotoStore, groupId: GroupId, memberId: MemberId, version: PhotoVersion): Promise<ArrayBuffer | null> {
  return store.get(keyOf(groupId, memberId, version), 'arrayBuffer');
}

/**
 * Deletes the bytes of versions no longer pointed to, after the answer: a member keeps two photos at most. A version pointed to again in between
 * (the same photo sent again) is kept; one pointed to again after this read, within milliseconds, loses its bytes and shows the initial until the
 * next photo. A failure only leaves bytes nobody reads, and is logged.
 */
export async function dropPhotos(
  db: D1Database,
  store: PhotoStore,
  groupId: GroupId,
  memberId: MemberId,
  versions: readonly PhotoVersion[],
): Promise<void> {
  const current = await readPhotos(db, groupId, memberId);
  for (const version of versions) {
    if (current?.photo !== version && current?.previous !== version) {
      await store.delete(keyOf(groupId, memberId, version)).catch((error: unknown) => {
        log({ photo: 'not_dropped', group: groupId, error: String(error) });
      });
    }
  }
}
