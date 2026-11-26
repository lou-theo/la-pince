import { describe, expect, it } from 'vitest';

import { isPhotoRequest, MAX_PHOTOS, type PhotoCache, servePhoto } from './photoCache.ts';

const origin = 'https://la-pince.example';
const address = (version: string) => `${origin}/api/groups/token/members/m1/photos/${version}`;
const jpeg = (body = 'photo') => new Response(body, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });

/** A cache in memory, keys in the order they were put, as the Cache API keeps them. */
function memoryCache(): PhotoCache & { readonly urls: () => string[] } {
  const kept = new Map<string, Response>();
  const urlOf = (request: RequestInfo | URL) => (request instanceof Request ? request.url : new URL(String(request), origin).href);
  return {
    match: (request) => Promise.resolve(kept.get(urlOf(request))?.clone()),
    put: async (request, response) => {
      kept.delete(urlOf(request));
      kept.set(urlOf(request), new Response(await response.arrayBuffer(), response));
    },
    keys: () => Promise.resolve([...kept.keys()].map((url) => new Request(url))),
    delete: (request) => Promise.resolve(kept.delete(urlOf(request))),
    urls: () => [...kept.keys()],
  };
}

describe('isPhotoRequest', () => {
  it('takes a GET of a version of a photo on the app’s origin, nothing else', () => {
    expect(isPhotoRequest(new Request(address('v1')), origin)).toBe(true);
    expect(isPhotoRequest(new Request(address('v1'), { method: 'PUT' }), origin)).toBe(false);
    expect(isPhotoRequest(new Request(`${origin}/api/groups/token/members/m1/photo`), origin)).toBe(false);
    expect(isPhotoRequest(new Request(`${origin}/api/groups/token`), origin)).toBe(false);
    expect(isPhotoRequest(new Request('https://elsewhere.example/api/groups/token/members/m1/photos/v1'), origin)).toBe(false);
  });
});

describe('servePhoto', () => {
  it('keeps a photo answered by the network, then serves it from the cache without asking again', async () => {
    const cache = memoryCache();
    let asked = 0;
    const fetchFn = () => {
      asked += 1;
      return Promise.resolve(jpeg());
    };
    expect(await (await servePhoto(new Request(address('v1')), cache, fetchFn)).text()).toBe('photo');
    expect(await (await servePhoto(new Request(address('v1')), cache, fetchFn)).text()).toBe('photo');
    expect(asked).toBe(1);
  });

  it('never keeps a missing photo, which may be there at the next try, nor an answer that is not a JPEG', async () => {
    const cache = memoryCache();
    const missing = await servePhoto(new Request(address('v1')), cache, () =>
      Promise.resolve(new Response('{"error":"photo_not_found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })),
    );
    expect(missing.status).toBe(404);
    await servePhoto(new Request(address('v2')), cache, () => Promise.resolve(new Response('<html>', { headers: { 'Content-Type': 'text/html' } })));
    expect(cache.urls()).toStrictEqual([]);
    await servePhoto(new Request(address('v1')), cache, () => Promise.resolve(jpeg()));
    expect(cache.urls()).toStrictEqual([address('v1')]);
  });

  it('answers a network error without network and without a copy, which the image shows by its initial', async () => {
    const answer = await servePhoto(new Request(address('v1')), memoryCache(), () => Promise.reject(new TypeError('Failed to fetch')));
    expect(answer.type).toBe('error');
  });

  it('drops the oldest photos past the most it keeps', async () => {
    const cache = memoryCache();
    for (let index = 0; index <= MAX_PHOTOS; index += 1) {
      await servePhoto(new Request(address(`v${String(index)}`)), cache, () => Promise.resolve(jpeg()));
    }
    expect(cache.urls()).toHaveLength(MAX_PHOTOS);
    expect(cache.urls()[0]).toBe(address('v1'));
  });
});
