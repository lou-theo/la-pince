import { afterEach, describe, expect, it, vi } from 'vitest';

import { memoryCache } from '../testing/photo.ts';
import { isPhotoRequest, keepSentPhoto, MAX_PHOTOS, preloadPhotos, servePhoto } from './photoCache.ts';

const origin = 'https://la-pince.example';
const address = (version: string) => `${origin}/api/groups/token/members/m1/photos/${version}`;
const jpeg = (body = 'photo') => new Response(body, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe('keepSentPhoto', () => {
  it('keeps the photo sent under its address, never over a copy already kept', async () => {
    const cache = memoryCache();
    vi.stubGlobal('caches', { open: () => Promise.resolve(cache) });
    await keepSentPhoto('/api/groups/token/members/m1/photos/v1', new Blob(['sent']));
    await keepSentPhoto('/api/groups/token/members/m1/photos/v1', new Blob(['again']));
    expect(await (await cache.match('/api/groups/token/members/m1/photos/v1'))?.text()).toBe('sent');
  });

  it('does nothing where the browser has no cache', async () => {
    vi.stubGlobal('caches', { open: () => Promise.reject(new DOMException('', 'SecurityError')) });
    await expect(keepSentPhoto('/api/groups/token/members/m1/photos/v1', new Blob(['sent']))).resolves.toBeUndefined();
  });
});

describe('preloadPhotos', () => {
  it('asks only for the photos the cache lacks, and asks again next time for one that failed', async () => {
    const cache = memoryCache();
    vi.stubGlobal('caches', { open: () => Promise.resolve(cache) });
    const asked: string[] = [];
    const fetchFn = (request: Request) => {
      asked.push(new URL(request.url).pathname);
      return Promise.resolve(request.url.endsWith('v2') ? new Response('', { status: 404 }) : jpeg());
    };
    const urls = ['/api/groups/token/members/m1/photos/v1', '/api/groups/token/members/m2/photos/v2'];
    await preloadPhotos(urls, fetchFn);
    await preloadPhotos(urls, fetchFn);
    expect(asked).toStrictEqual([urls[0], urls[1], urls[1]]);
  });

  it('asks for nothing where the browser has no cache', async () => {
    vi.stubGlobal('caches', { open: () => Promise.reject(new DOMException('', 'SecurityError')) });
    let asked = 0;
    await preloadPhotos(['/api/groups/token/members/m1/photos/v1'], () => {
      asked += 1;
      return Promise.resolve(jpeg());
    });
    expect(asked).toBe(0);
  });
});
