import { type ApiError, type GroupResponse, groupResponseSchema } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { createApiClient, type Fetch } from './client.ts';

const token = 'demo-token-of-the-client-tests-0123456789';
const group = groupResponseSchema.parse({
  title: 'Week-end',
  members: [
    { id: 'm1', name: 'Alice' },
    { id: 'm2', name: 'Bruno' },
  ],
} satisfies { title: string; members: { id: string; name: string }[] });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('fetchGroup', () => {
  it('reads the group of a token from the API, title and members in their order', async () => {
    const urls: string[] = [];
    const fetchFn: Fetch = (url) => {
      urls.push(url);
      return Promise.resolve(json(group satisfies GroupResponse));
    };
    expect(await createApiClient(fetchFn).fetchGroup(token)).toStrictEqual({ ok: true, group });
    expect(urls).toStrictEqual([`/api/groups/${token}`]);
  });

  it('tells an unknown link from a server out of reach and from an answer outside the contract', async () => {
    const answer = (response: Response | Error) =>
      createApiClient(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)));
    expect(await answer(json({ error: 'group_not_found' } satisfies ApiError, 404)).fetchGroup(token)).toStrictEqual({
      ok: false,
      error: 'group_not_found',
    });
    expect(await answer(new TypeError('Failed to fetch')).fetchGroup(token)).toStrictEqual({ ok: false, error: 'network' });
    expect(await answer(json({ title: 'Week-end', members: [] })).fetchGroup(token)).toStrictEqual({ ok: false, error: 'unexpected' });
    expect(await answer(new Response('<html>', { status: 200 })).fetchGroup(token)).toStrictEqual({ ok: false, error: 'unexpected' });
    expect(await answer(new Response('', { status: 502 })).fetchGroup(token)).toStrictEqual({ ok: false, error: 'unexpected' });
    expect(await answer(json({ error: 'invalid_request' } satisfies ApiError, 400)).fetchGroup(token)).toStrictEqual({
      ok: false,
      error: 'unexpected',
    });
  });
});
