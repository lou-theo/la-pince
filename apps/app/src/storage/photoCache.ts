/** Cache of the members' photos, shared by the service worker, which serves them from it, and the page, which fills it. */
export const PHOTO_CACHE = 'la-pince-photos';

/** Photos kept at most, the oldest dropped first: a phone with a few groups of a dozen members, whose photos change now and then, stays far below. */
export const MAX_PHOTOS = 300;

const PHOTO_PATH = /^\/api\/groups\/[^/]+\/members\/[^/]+\/photos\/[^/]+$/;

/** Whether a request asks for a version of a member's photo (`photoUrl`), whose bytes never change. */
export function isPhotoRequest(request: Request, origin: string): boolean {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === origin && PHOTO_PATH.test(url.pathname);
}

/** The part of the Cache API used here, so that a test hands a cache of its own. */
export type PhotoCache = Pick<Cache, 'match' | 'put' | 'keys' | 'delete'>;

/** Keeps a photo's answer, then drops the oldest photos past `MAX_PHOTOS` (the keys come in the order they were put). */
async function keep(cache: PhotoCache, request: Request | string, response: Response): Promise<void> {
  await cache.put(request, response);
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_PHOTOS))) {
    await cache.delete(old);
  }
}

/**
 * A photo from the cache, else from the network, kept when it is one: a JPEG answered 200. Nothing else is kept, a 404 above all: a photo just
 * changed elsewhere may be missing a moment from the server's store (docs/decisions/photos-stockage.md, point a), and must load at the next try.
 * Without network and without a copy, a network error, which the image shows by its `onError`.
 */
export async function servePhoto(request: Request, cache: PhotoCache, fetchFn: (request: Request) => Promise<Response>): Promise<Response> {
  const kept = await cache.match(request);
  if (kept !== undefined) {
    return kept;
  }
  let response: Response;
  try {
    response = await fetchFn(request);
  } catch {
    return Response.error();
  }
  if (response.status === 200 && response.headers.get('Content-Type') === 'image/jpeg') {
    await keep(cache, request, response.clone()).catch(() => undefined);
  }
  return response;
}

/** Opens the cache of photos, or `undefined` where the browser has none (a page served without HTTPS, a test environment). */
async function openPhotoCache(): Promise<PhotoCache | undefined> {
  try {
    return await caches.open(PHOTO_CACHE);
  } catch {
    return undefined;
  }
}

/**
 * Keeps the photo this phone just sent under its address, before the screens show it: the one who changed it sees it at once, offline too, without
 * waiting for the server's store to show it (docs/decisions/photos-stockage.md, point a).
 */
export async function keepSentPhoto(url: string, photo: Blob): Promise<void> {
  const cache = await openPhotoCache();
  if (cache !== undefined && (await cache.match(url)) === undefined) {
    await keep(cache, url, new Response(photo, { headers: { 'Content-Type': 'image/jpeg' } }));
  }
}

/**
 * Loads into the cache the photos it lacks, one after the other, so that every member's photo shows offline, those never seen on this phone
 * included; one that fails is tried again at the next call.
 */
export async function preloadPhotos(urls: readonly string[], fetchFn: (request: Request) => Promise<Response>): Promise<void> {
  const cache = await openPhotoCache();
  if (cache === undefined) {
    return;
  }
  for (const url of urls) {
    const response = await servePhoto(new Request(new URL(url, location.href)), cache, fetchFn);
    // Read to the end, so that the browser can reuse the connection.
    await response.arrayBuffer().catch(() => undefined);
  }
}
