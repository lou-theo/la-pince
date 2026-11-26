import { MAX_PHOTO_BYTES } from '@la-pince/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stubPicture, syntheticJpeg } from '../testing/photo.ts';
import { reducePhoto } from './reducePhoto.ts';

const picture = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
const tooHeavy = () => new Uint8Array(MAX_PHOTO_BYTES + 1);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('reducePhoto', () => {
  it('draws the middle square in halves down to 256 px, and gives the JPEG of the first quality', async () => {
    const { drawn, qualities } = stubPicture({ width: 3024, height: 4032 });
    const reduced = await reducePhoto(picture);
    expect(reduced.ok && reduced.photo.type).toBe('image/jpeg');
    expect(drawn).toStrictEqual([1512, 756, 378, 256]);
    expect(qualities).toStrictEqual([0.85]);
  });

  it('encodes again at lower qualities while the JPEG weighs more than the server takes', async () => {
    const { qualities } = stubPicture({ encode: (quality) => (quality > 0.6 ? tooHeavy() : syntheticJpeg(2)) });
    const reduced = await reducePhoto(picture);
    expect(reduced.ok && new Uint8Array(await reduced.photo.arrayBuffer())).toStrictEqual(syntheticJpeg(2));
    expect(qualities).toStrictEqual([0.85, 0.7, 0.5]);
  });

  it('gives up when even the lowest quality weighs too much, or when the browser encodes something else than JPEG', async () => {
    stubPicture({ encode: tooHeavy });
    expect(await reducePhoto(picture)).toStrictEqual({ ok: false, error: 'not_encoded' });
    vi.restoreAllMocks();
    stubPicture({ type: 'image/png' });
    expect(await reducePhoto(picture)).toStrictEqual({ ok: false, error: 'not_encoded' });
  });

  it('says a picture the browser cannot decode is unreadable, by either way of decoding', async () => {
    stubPicture({ decodes: false });
    expect(await reducePhoto(picture)).toStrictEqual({ ok: false, error: 'unreadable' });
  });
});
