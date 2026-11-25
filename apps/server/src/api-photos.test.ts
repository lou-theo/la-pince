import { apiErrorSchema, MAX_PHOTO_BYTES } from '@la-pince/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestHarness } from 'wrangler';

import type { Env } from './index.ts';
import { photoVersion } from './photos.ts';

// The photo routes in workerd, with the local KV of `wrangler.jsonc` and a local D1. `photos.test.ts` plays the races and a KV that fails.
const ADMIN_TOKEN = 'admin-token-of-the-tests-0123456789';
const server = createTestHarness({ workers: [{ configPath: './wrangler.jsonc', secrets: { ADMIN_TOKEN } }] });

beforeAll(async () => {
  await server.listen();
  await server.getWorker().applyD1Migrations('DB');
});

afterAll(async () => {
  await server.close();
});

type Fetched = Awaited<ReturnType<typeof server.fetch>>;

const admin = (id: string, body: unknown) =>
  server.fetch(`/api/admin/groups/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }, body: JSON.stringify(body) });

let groups = 0;
const newGroup = async () => {
  groups += 1;
  const id = `photos${String(groups)}`;
  const token = `${id}-token-${'x'.repeat(32)}`;
  const body = {
    title: 'Trip',
    token,
    members: [
      { id: 'alice', name: 'ALICE' },
      { id: 'bob', name: 'BOB' },
    ],
  };
  expect((await admin(id, body)).status).toBe(200);
  return { id, token, body };
};

// Comment segments of `length` bytes in all, headers included, each one holding 60 000 bytes at most.
const comments = (length: number): number[] => {
  const payload = Math.min(length - 4, 60000);
  return length <= 0
    ? []
    : [0xff, 0xfe, (payload + 2) >> 8, (payload + 2) & 0xff, ...Array.from({ length: payload }, () => 0x20), ...comments(length - payload - 4)];
};

/** A synthetic JPEG (start, comments of `padding` bytes, frame of the given size, scan, end), told apart from another by `seed`. */
const jpeg = (seed: number, width = 256, height = 256, padding = 0) =>
  new Uint8Array([
    ...[0xff, 0xd8],
    ...comments(padding),
    ...[0xff, 0xc0, 0, 11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0],
    ...[0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, seed, 0xff, 0xd9],
  ]);
const v = (seed: number) => photoVersion(jpeg(seed));

const put = (token: string, member: string, bytes: Uint8Array | string, type = 'image/jpeg') =>
  server.fetch(`/api/groups/${token}/members/${member}/photo`, { method: 'PUT', headers: { 'Content-Type': type }, body: bytes });
const undo = (token: string, member: string, body: unknown) =>
  server.fetch(`/api/groups/${token}/members/${member}/photo/undo`, { method: 'POST', body: JSON.stringify(body) });
const remove = (token: string, member: string) => server.fetch(`/api/groups/${token}/members/${member}/photo`, { method: 'DELETE' });
const get = (token: string, member: string, version: string) => server.fetch(`/api/groups/${token}/members/${member}/photos/${version}`);

const errorOf = async (response: Fetched) => [response.status, apiErrorSchema.parse(await response.json()).error];
const read = async (token: string) => (await server.fetch(`/api/groups/${token}`)).json();
const photoOf = async (token: string, member: string) =>
  ((await read(token)) as { members: { id: string; photo?: string }[] }).members.find((entry) => entry.id === member)?.photo;
const photos = async () => {
  const { PHOTOS } = await server.getWorker<Env>().getEnv();
  if (PHOTOS === undefined) {
    throw new Error('the test config has no PHOTOS binding');
  }
  return PHOTOS;
};
const keys = async (groupId: string) => (await (await photos()).list({ prefix: `photo/${groupId}/` })).keys.map((key) => key.name).toSorted();
const keyOf = (groupId: string, member: string, version: string) => `photo/${groupId}/${member}/${version}`;
// Bytes no version points to are deleted after the answer is sent.
const expectKeys = async (groupId: string, expected: string[]) => {
  await vi.waitFor(async () => {
    expect(await keys(groupId)).toStrictEqual(expected.toSorted());
  });
};

describe('PUT /api/groups/:token/members/:id/photo', () => {
  it('stores the photo under its version and answers with the group, which tells the instance keeps photos', async () => {
    const { id, token } = await newGroup();
    const response = await put(token, 'alice', jpeg(1));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual({
      title: 'Trip',
      members: [
        { id: 'alice', name: 'ALICE', photo: await v(1) },
        { id: 'bob', name: 'BOB' },
      ],
      photos: true,
    });
    expect(await keys(id)).toStrictEqual([keyOf(id, 'alice', await v(1))]);
  });

  it('answers the same bytes sent again with the group, writing nothing', async () => {
    const { id, token } = await newGroup();
    expect((await put(token, 'alice', jpeg(1))).status).toBe(200);
    // Overwritten by the test: a second write would put the photo back.
    await (await photos()).put(keyOf(id, 'alice', await v(1)), 'marker');
    expect((await put(token, 'alice', jpeg(1))).status).toBe(200);
    expect(await (await photos()).get(keyOf(id, 'alice', await v(1)))).toBe('marker');
  });

  it('keeps the photo before the current one, and deletes the one before that', async () => {
    const { id, token } = await newGroup();
    await put(token, 'alice', jpeg(1));
    await put(token, 'alice', jpeg(2));
    await expectKeys(id, [keyOf(id, 'alice', await v(1)), keyOf(id, 'alice', await v(2))]);
    await put(token, 'alice', jpeg(3));
    await expectKeys(id, [keyOf(id, 'alice', await v(2)), keyOf(id, 'alice', await v(3))]);
    expect(await photoOf(token, 'alice')).toBe(await v(3));
  });

  it('keeps the photos of each member apart, the same bytes included', async () => {
    const { id, token } = await newGroup();
    await put(token, 'alice', jpeg(1));
    await put(token, 'bob', jpeg(1));
    expect(await keys(id)).toStrictEqual([keyOf(id, 'alice', await v(1)), keyOf(id, 'bob', await v(1))]);
  });

  it.each([
    ['another type', (token: string) => put(token, 'alice', jpeg(1), 'image/png')],
    ['a PNG sent as a JPEG', (token: string) => put(token, 'alice', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
    ['an empty body', (token: string) => put(token, 'alice', new Uint8Array())],
    ['a photo 257 pixels wide', (token: string) => put(token, 'alice', jpeg(1, 257, 10))],
    ['a photo 257 pixels high', (token: string) => put(token, 'alice', jpeg(1, 10, 257))],
    ['a photo over 200 KB', (token: string) => put(token, 'alice', jpeg(1, 10, 10, MAX_PHOTO_BYTES))],
    ['a member id out of the alphabet', (token: string) => put(token, 'al%20ice', jpeg(1))],
  ])('refuses %s', async (_, send) => {
    const { id, token } = await newGroup();
    expect(await errorOf(await send(token))).toStrictEqual([400, 'invalid_request']);
    expect(await photoOf(token, 'alice')).toBeUndefined();
    expect(await keys(id)).toStrictEqual([]);
  });

  // Without a length, the limit is the only thing that stops reading: a body far over it is cut once the limit is passed.
  it('stops reading a body sent without its length once past 200 KB', async () => {
    const { token } = await newGroup();
    const chunk = new Uint8Array(64 * 1024);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 320) {
          controller.close();
        } else {
          controller.enqueue(chunk);
        }
      },
    });
    // The Worker answers 400 then drops the rest of the body while the test still writes: on the test's side, the request may then fail (EPIPE)
    // or come back as a 500 of the local proxy. What tells the limit worked is that the body was not read to its end.
    const init = { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body, duplex: 'half' as const };
    const status = await server.fetch(`/api/groups/${token}/members/alice/photo`, init).then(
      (response) => response.status,
      () => 'cut',
    );
    expect(status).not.toBe(200);
    expect(pulled).toBeLessThan(320);
    expect(await photoOf(token, 'alice')).toBeUndefined();
  });

  it('accepts a photo of exactly 256 pixels and 200 KB', async () => {
    const { token } = await newGroup();
    const bytes = jpeg(1, 256, 256, MAX_PHOTO_BYTES - jpeg(1).length);
    expect(bytes).toHaveLength(MAX_PHOTO_BYTES);
    expect((await put(token, 'alice', bytes)).status).toBe(200);
  });

  it('answers member_not_found for a member of another group', async () => {
    const { token } = await newGroup();
    const other = await newGroup();
    await server.fetch(`/api/groups/${other.token}/members`, { method: 'POST', body: JSON.stringify({ id: 'carol', name: 'Carol' }) });
    expect(await errorOf(await put(token, 'carol', jpeg(1)))).toStrictEqual([404, 'member_not_found']);
  });

  it('answers group_not_found for an unknown link', async () => {
    expect(await errorOf(await put('z'.repeat(32), 'alice', jpeg(1)))).toStrictEqual([404, 'group_not_found']);
  });
});

describe('POST /api/groups/:token/members/:id/photo/undo', () => {
  it('puts back the photo before, keeping both, and answers a replay the same', async () => {
    const { id, token } = await newGroup();
    await put(token, 'alice', jpeg(1));
    await put(token, 'alice', jpeg(2));
    const body = { version: await v(2), previous: await v(1) };
    const response = await undo(token, 'alice', body);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { members: { photo?: string }[] }).members[0]?.photo).toBe(await v(1));
    expect((await undo(token, 'alice', body)).status).toBe(200);
    expect(await photoOf(token, 'alice')).toBe(await v(1));
    await expectKeys(id, [keyOf(id, 'alice', await v(1)), keyOf(id, 'alice', await v(2))]);
  });

  it('removes a first photo, back to the initial', async () => {
    const { token } = await newGroup();
    await put(token, 'alice', jpeg(1));
    expect((await undo(token, 'alice', { version: await v(1), previous: null })).status).toBe(200);
    expect(await photoOf(token, 'alice')).toBeUndefined();
  });

  it('answers photo_changed when someone else changed the photo in between, and leaves it', async () => {
    const { token } = await newGroup();
    await put(token, 'alice', jpeg(1));
    await put(token, 'alice', jpeg(2));
    await put(token, 'alice', jpeg(3));
    expect(await errorOf(await undo(token, 'alice', { version: await v(2), previous: await v(1) }))).toStrictEqual([409, 'photo_changed']);
    expect(await photoOf(token, 'alice')).toBe(await v(3));
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['the same version on both sides', { version: 'a'.repeat(22), previous: 'a'.repeat(22) }],
    ['a version out of format', { version: 'x', previous: null }],
  ])('refuses %s', async (_, body) => {
    const { token } = await newGroup();
    expect(await errorOf(await undo(token, 'alice', body))).toStrictEqual([400, 'invalid_request']);
  });

  it('answers member_not_found for an unknown member', async () => {
    const { token } = await newGroup();
    expect(await errorOf(await undo(token, 'nobody', { version: 'a'.repeat(22), previous: null }))).toStrictEqual([404, 'member_not_found']);
  });
});

describe('DELETE /api/groups/:token/members/:id/photo', () => {
  it('removes the photo, keeps its bytes for an undo, and the undo puts it back', async () => {
    const { id, token } = await newGroup();
    await put(token, 'alice', jpeg(1));
    const response = await remove(token, 'alice');
    expect(response.status).toBe(200);
    expect(((await response.json()) as { members: { photo?: string }[] }).members[0]).toStrictEqual({ id: 'alice', name: 'ALICE' });
    expect((await remove(token, 'alice')).status).toBe(200);
    expect(await keys(id)).toStrictEqual([keyOf(id, 'alice', await v(1))]);
    expect((await undo(token, 'alice', { version: null, previous: await v(1) })).status).toBe(200);
    expect(await photoOf(token, 'alice')).toBe(await v(1));
  });

  it('deletes the photo before the removed one, so that a member keeps two at most', async () => {
    const { id, token } = await newGroup();
    await put(token, 'alice', jpeg(1));
    await put(token, 'alice', jpeg(2));
    expect((await remove(token, 'alice')).status).toBe(200);
    await expectKeys(id, [keyOf(id, 'alice', await v(2))]);
  });

  it('answers member_not_found for an unknown member', async () => {
    const { token } = await newGroup();
    expect(await errorOf(await remove(token, 'nobody'))).toStrictEqual([404, 'member_not_found']);
  });
});

describe('GET /api/groups/:token/members/:id/photos/:version', () => {
  it('serves the bytes as a JPEG kept a year by the browser alone', async () => {
    const { token } = await newGroup();
    await put(token, 'alice', jpeg(1));
    const response = await get(token, 'alice', await v(1));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toStrictEqual(jpeg(1));
  });

  it.each([
    ['a version never stored', 'a'.repeat(22)],
    ['an address no version has', 'x'],
  ])('answers photo_not_found, never kept by a cache, for %s', async (_, version) => {
    const { token } = await newGroup();
    const response = await get(token, 'alice', version);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await errorOf(response)).toStrictEqual([404, 'photo_not_found']);
  });

  it('does not serve the photo of a member through the link of another group', async () => {
    const { token } = await newGroup();
    const other = await newGroup();
    await put(token, 'alice', jpeg(1));
    expect(await errorOf(await get(other.token, 'alice', await v(1)))).toStrictEqual([404, 'photo_not_found']);
    expect(await errorOf(await get('z'.repeat(32), 'alice', await v(1)))).toStrictEqual([404, 'group_not_found']);
  });
});

describe('the admin route', () => {
  it('keeps the photos when a group is imported again', async () => {
    const { id, token, body } = await newGroup();
    await put(token, 'alice', jpeg(1));
    expect((await admin(id, { ...body, title: 'Trip again' })).status).toBe(200);
    expect(await photoOf(token, 'alice')).toBe(await v(1));
  });

  it('refuses a photo on a member', async () => {
    const { id, body } = await newGroup();
    const response = await admin(id, { ...body, members: [{ id: 'alice', name: 'ALICE', photo: await v(1) }] });
    expect(await errorOf(response)).toStrictEqual([400, 'invalid_request']);
  });
});
