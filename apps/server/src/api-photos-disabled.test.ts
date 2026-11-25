import { apiErrorSchema } from '@la-pince/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';

import type { Env } from './index.ts';

// An instance whose config has no KV binding, as one deployed before setting photos up: the config of `wrangler.jsonc` without `kv_namespaces`.
const ADMIN_TOKEN = 'admin-token-of-the-tests-0123456789';
const server = createTestHarness({
  workers: [
    {
      config: {
        name: 'la-pince-without-photos',
        main: 'src/index.ts',
        compatibility_date: '2026-11-01',
        d1_databases: [{ binding: 'DB', database_name: 'la-pince', database_id: 'local', migrations_dir: 'drizzle' }],
        vars: { ADMIN_TOKEN },
      },
    },
  ],
});

beforeAll(async () => {
  await server.listen();
  await server.getWorker().applyD1Migrations('DB');
});

afterAll(async () => {
  await server.close();
});

const token = `nophotos-token-${'x'.repeat(32)}`;
const version = 'a'.repeat(22);

describe('an instance without photos', () => {
  it('sends neither photos nor a member photo, even one D1 still holds', async () => {
    const response = await server.fetch('/api/admin/groups/nophotos', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ title: 'Trip', token, members: [{ id: 'alice', name: 'ALICE' }] }),
    });
    expect(response.status).toBe(200);
    const { DB } = await server.getWorker<Env>().getEnv();
    await DB.prepare("UPDATE members SET photo = ? WHERE group_id = 'nophotos'").bind(version).run();
    expect(await (await server.fetch(`/api/groups/${token}`)).json()).toStrictEqual({ title: 'Trip', members: [{ id: 'alice', name: 'ALICE' }] });
  });

  it.each([
    ['PUT', '/photo'],
    ['POST', '/photo/undo'],
    ['DELETE', '/photo'],
    ['GET', `/photos/${version}`],
  ])('answers photos_disabled to %s %s, never kept by a cache', async (method, path) => {
    const response = await server.fetch(`/api/groups/${token}/members/alice${path}`, { method });
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(apiErrorSchema.parse(await response.json()).error).toBe('photos_disabled');
  });
});
