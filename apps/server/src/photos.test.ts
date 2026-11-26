import { type GroupId, groupIdSchema, type MemberId, memberIdSchema, type PhotoVersion, photoVersionSchema } from '@la-pince/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestHarness } from 'wrangler';

import type { Env } from './index.ts';
import { dropPhotos, type PhotoStore, photoVersion, readPhoto, removePhoto, setPhoto, undoPhoto } from './photos.ts';

// The statements run against the local D1 of workerd, called from the tests with a store in memory: a concurrent request is played by a store that
// lets another change pass between the write of the bytes and the write of the versions.
const server = createTestHarness({ workers: [{ configPath: './wrangler.jsonc' }] });
let db: D1Database;

beforeAll(async () => {
  await server.listen();
  await server.getWorker().applyD1Migrations('DB');
  db = (await server.getWorker<Env>().getEnv()).DB;
});

afterAll(async () => {
  await server.close();
});

const alice = memberIdSchema.parse('alice');

let groups = 0;
const newGroup = async (): Promise<GroupId> => {
  groups += 1;
  const id = groupIdSchema.parse(`photo-store${String(groups)}`);
  await db.batch([
    db.prepare('INSERT INTO groups (id, token_hash, title) VALUES (?, ?, ?)').bind(id, `hash-${id}`, 'Trip'),
    db.prepare("INSERT INTO members (group_id, id, name, position) VALUES (?, 'alice', 'Alice', 0)").bind(id),
  ]);
  return id;
};

class MemoryStore implements PhotoStore {
  readonly bytes = new Map<string, Uint8Array>();
  puts = 0;
  /** Runs after the next write of bytes, before the caller goes on. */
  afterPut: (() => Promise<void>) | undefined;
  putError: Error | undefined;
  getError: Error | undefined;
  deleteError: Error | undefined;

  async put(key: string, value: Uint8Array): Promise<void> {
    this.puts += 1;
    if (this.putError !== undefined) {
      throw this.putError;
    }
    this.bytes.set(key, value);
    const after = this.afterPut;
    this.afterPut = undefined;
    await after?.();
  }

  get(key: string): Promise<ArrayBuffer | null> {
    if (this.getError !== undefined) {
      return Promise.reject(this.getError);
    }
    const value = this.bytes.get(key);
    return Promise.resolve(value === undefined ? null : new Uint8Array(value).buffer);
  }

  delete(key: string): Promise<void> {
    if (this.deleteError !== undefined) {
      return Promise.reject(this.deleteError);
    }
    this.bytes.delete(key);
    return Promise.resolve();
  }
}

const photo = (seed: number) => new Uint8Array([0xff, 0xd8, seed, 0xff, 0xd9]);
const versions = async (groupId: GroupId, memberId: MemberId = alice) =>
  db.prepare('SELECT photo, previous_photo AS previous FROM members WHERE group_id = ? AND id = ?').bind(groupId, memberId).first();
const keyOf = (groupId: GroupId, version: PhotoVersion) => `photo/${groupId}/alice/${version}`;

describe('photoVersion', () => {
  it('is the first 16 bytes of the SHA-256 of the bytes, in base64url', async () => {
    // SHA-256 of an empty input: e3b0c442 98fc1c14 9afbf4c8 996fb924 …
    expect(await photoVersion(new Uint8Array())).toBe('47DEQpj8HBSa-_TImW-5JA');
  });
});

describe('setPhoto', () => {
  it('writes the bytes, then the versions, the photo before becoming the one an undo puts back', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    const [first, second] = [await photoVersion(photo(1)), await photoVersion(photo(2))];
    expect(await setPhoto(db, store, groupId, alice, photo(1))).toStrictEqual({
      outcome: 'set',
      dropped: [],
      undo: { version: first, previous: null },
    });
    expect(await setPhoto(db, store, groupId, alice, photo(2))).toStrictEqual({
      outcome: 'set',
      dropped: [],
      undo: { version: second, previous: first },
    });
    expect(await versions(groupId)).toStrictEqual({ photo: second, previous: first });
    expect(await setPhoto(db, store, groupId, alice, photo(3))).toStrictEqual({
      outcome: 'set',
      dropped: [first],
      undo: { version: await photoVersion(photo(3)), previous: second },
    });
  });

  // The phone that sends a photo may not have seen the one another phone set since its last read: the server tells the undo, which then passes.
  it('gives the undo of the version it replaced, which the sender may not know', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    const [first, second, third] = [await photoVersion(photo(1)), await photoVersion(photo(2)), await photoVersion(photo(3))];
    await setPhoto(db, store, groupId, alice, photo(1));
    await setPhoto(db, store, groupId, alice, photo(2));
    expect((await setPhoto(db, store, groupId, alice, photo(3))).undo).toStrictEqual({ version: third, previous: second });
    // What the sender knew would be refused.
    expect((await undoPhoto(db, groupId, alice, { version: third, previous: first })).outcome).toBe('photo_changed');
    expect((await undoPhoto(db, groupId, alice, { version: third, previous: second })).outcome).toBe('undone');
    expect(await versions(groupId)).toStrictEqual({ photo: second, previous: third });
  });

  it('answers a replay without writing the bytes again', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    await setPhoto(db, store, groupId, alice, photo(1));
    expect(await setPhoto(db, store, groupId, alice, photo(1))).toStrictEqual({
      outcome: 'replayed',
      dropped: [],
      undo: { version: await photoVersion(photo(1)), previous: null },
    });
    expect(store.puts).toBe(1);
  });

  it('writes back the bytes of the photo sent again when they were lost, after a restore of the database', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    const version = await photoVersion(photo(1));
    await setPhoto(db, store, groupId, alice, photo(1));
    store.bytes.clear();
    expect(await setPhoto(db, store, groupId, alice, photo(1))).toStrictEqual({
      outcome: 'replayed',
      dropped: [],
      undo: { version, previous: null },
    });
    expect(store.bytes.get(keyOf(groupId, version))).toStrictEqual(photo(1));
  });

  it('goes on when KV refuses to write bytes already stored under the key, by the same photo sent twice at once', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    const version = await photoVersion(photo(1));
    store.bytes.set(keyOf(groupId, version), photo(1));
    store.putError = new Error('KV PUT failed: 429 Too Many Requests');
    expect(await setPhoto(db, store, groupId, alice, photo(1))).toStrictEqual({ outcome: 'set', dropped: [], undo: { version, previous: null } });
    expect(await versions(groupId)).toStrictEqual({ photo: version, previous: null });
  });

  it('answers photos_unavailable when KV refuses both the read and the write of a photo sent again', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    const version = await photoVersion(photo(1));
    await setPhoto(db, store, groupId, alice, photo(1));
    store.getError = new Error('KV GET failed: 500');
    store.putError = new Error('KV PUT failed: 500');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await setPhoto(db, store, groupId, alice, photo(1))).toStrictEqual({ outcome: 'photos_unavailable', dropped: [] });
    log.mockRestore();
    expect(await versions(groupId)).toStrictEqual({ photo: version, previous: null });
  });

  it('answers photos_unavailable and changes nothing when KV refuses the write', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    store.putError = new Error('KV PUT failed: 429 Too Many Requests');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await setPhoto(db, store, groupId, alice, photo(1))).toStrictEqual({ outcome: 'photos_unavailable', dropped: [] });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
    expect(await versions(groupId)).toStrictEqual({ photo: null, previous: null });
  });

  it('answers member_not_found for a member of another group', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    expect(await setPhoto(db, store, groupId, memberIdSchema.parse('bob'), photo(1))).toStrictEqual({ outcome: 'member_not_found', dropped: [] });
    expect(store.bytes.size).toBe(0);
  });

  it('keeps both photos sent at the same time, the last written in front, and drops what neither points to', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    const [first, second, third] = [await photoVersion(photo(1)), await photoVersion(photo(2)), await photoVersion(photo(3))];
    await setPhoto(db, store, groupId, alice, photo(1));
    // The second request writes its versions between the bytes and the versions of the first, which read the member before it.
    let concurrent: Awaited<ReturnType<typeof setPhoto>> | undefined;
    store.afterPut = async () => {
      concurrent = await setPhoto(db, store, groupId, alice, photo(3));
    };
    expect(await setPhoto(db, store, groupId, alice, photo(2))).toStrictEqual({
      outcome: 'set',
      dropped: [first],
      undo: { version: second, previous: third },
    });
    expect(concurrent).toStrictEqual({ outcome: 'set', dropped: [], undo: { version: third, previous: first } });
    expect(await versions(groupId)).toStrictEqual({ photo: second, previous: third });
  });

  it('answers a replay when the same photo was set in between', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    store.afterPut = async () => {
      expect((await setPhoto(db, store, groupId, alice, photo(1))).outcome).toBe('set');
    };
    expect(await setPhoto(db, store, groupId, alice, photo(1))).toStrictEqual({
      outcome: 'replayed',
      dropped: [],
      undo: { version: await photoVersion(photo(1)), previous: null },
    });
  });
});

describe('undoPhoto', () => {
  it('puts back the photo before while the undone one is the photo, then answers a replay', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    const [first, second] = [await photoVersion(photo(1)), await photoVersion(photo(2))];
    await setPhoto(db, store, groupId, alice, photo(1));
    await setPhoto(db, store, groupId, alice, photo(2));
    expect(await undoPhoto(db, groupId, alice, { version: second, previous: first })).toStrictEqual({
      outcome: 'undone',
      dropped: [],
      undo: { version: first, previous: second },
    });
    expect(await versions(groupId)).toStrictEqual({ photo: first, previous: second });
    expect(await undoPhoto(db, groupId, alice, { version: second, previous: first })).toStrictEqual({ outcome: 'replayed', dropped: [] });
  });

  it('never undoes a change made since by someone else', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    const [first, second] = [await photoVersion(photo(1)), await photoVersion(photo(2))];
    await setPhoto(db, store, groupId, alice, photo(1));
    await setPhoto(db, store, groupId, alice, photo(2));
    await removePhoto(db, groupId, alice);
    expect(await undoPhoto(db, groupId, alice, { version: second, previous: first })).toStrictEqual({ outcome: 'photo_changed', dropped: [] });
    expect(await versions(groupId)).toStrictEqual({ photo: null, previous: second });
  });

  it('answers member_not_found for an unknown member', async () => {
    const groupId = await newGroup();
    const version = photoVersionSchema.parse('a'.repeat(22));
    expect(await undoPhoto(db, groupId, memberIdSchema.parse('bob'), { version, previous: null })).toStrictEqual({
      outcome: 'member_not_found',
      dropped: [],
    });
  });
});

describe('removePhoto', () => {
  it('keeps the removed photo for an undo, drops the one before, and leaves a member without a photo as it is', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    const [first, second] = [await photoVersion(photo(1)), await photoVersion(photo(2))];
    expect(await removePhoto(db, groupId, alice)).toStrictEqual({ outcome: 'replayed', dropped: [] });
    await setPhoto(db, store, groupId, alice, photo(1));
    await setPhoto(db, store, groupId, alice, photo(2));
    expect(await removePhoto(db, groupId, alice)).toStrictEqual({ outcome: 'removed', dropped: [first], undo: { version: null, previous: second } });
    expect(await removePhoto(db, groupId, alice)).toStrictEqual({ outcome: 'replayed', dropped: [], undo: { version: null, previous: second } });
    expect(await versions(groupId)).toStrictEqual({ photo: null, previous: second });
  });
});

describe('dropPhotos', () => {
  it('deletes the bytes of a version no longer pointed to, and keeps one pointed to again in between', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    const [first, second, third] = [await photoVersion(photo(1)), await photoVersion(photo(2)), await photoVersion(photo(3))];
    await setPhoto(db, store, groupId, alice, photo(1));
    await setPhoto(db, store, groupId, alice, photo(2));
    await setPhoto(db, store, groupId, alice, photo(3));
    // The first photo is sent again before its bytes are deleted.
    await setPhoto(db, store, groupId, alice, photo(1));
    await dropPhotos(db, store, groupId, alice, [first, second]);
    expect([...store.bytes.keys()].toSorted()).toStrictEqual([keyOf(groupId, first), keyOf(groupId, third)].toSorted());
    expect(await readPhoto(store, groupId, alice, second)).toBeNull();
    expect(new Uint8Array((await readPhoto(store, groupId, alice, first)) ?? new ArrayBuffer())).toStrictEqual(photo(1));
  });

  it('only logs a delete that fails', async () => {
    const groupId = await newGroup();
    const store = new MemoryStore();
    store.deleteError = new Error('KV DELETE failed');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await dropPhotos(db, store, groupId, alice, [await photoVersion(photo(9))]);
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
