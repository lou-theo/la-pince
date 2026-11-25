import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isAcceptedPhoto, jpegSize, MAX_PHOTO_BYTES, photoUndoSchema, photoVersionSchema } from './photo.ts';

const segment = (marker: number, payload: readonly number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const app0 = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const frame = (marker: number, width: number, height: number) =>
  segment(marker, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0]);
const scan = [...segment(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34];

/** A synthetic JPEG: start, an APP0 segment, the given segments, then a scan and the end; its image data is not decodable, only its markers count. */
const jpeg = (...segments: readonly (readonly number[])[]) => new Uint8Array([0xff, 0xd8, ...app0, ...segments.flat(), ...scan, 0xff, 0xd9]);

describe('jpegSize', () => {
  it.each([
    ['a baseline frame', 0xc0],
    ['a progressive frame', 0xc2],
    ['a lossless arithmetic frame', 0xcf],
  ])('reads width and height from %s', (_, marker) => {
    expect(jpegSize(jpeg(frame(marker, 200, 150)))).toStrictEqual({ width: 200, height: 150 });
  });

  it('skips the segments before the frame, fill bytes and markers without a length', () => {
    const tables = segment(0xc4, [0, 1, 2, 3]);
    expect(
      jpegSize(
        jpeg(
          tables,
          [0xff, 0xff, 0xd0],
          segment(
            0xdb,
            Array.from({ length: 65 }, () => 1),
          ),
          frame(0xc1, 256, 1),
        ),
      ),
    ).toStrictEqual({
      width: 256,
      height: 1,
    });
  });

  it('reads sizes on two bytes', () => {
    expect(jpegSize(jpeg(frame(0xc0, 4032, 3024)))).toStrictEqual({ width: 4032, height: 3024 });
  });

  it.each([
    ['no bytes', new Uint8Array()],
    ['a PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])],
    ['a JPEG without its end', jpeg(frame(0xc0, 10, 10)).slice(0, -2)],
    ['a JPEG cut inside its frame', new Uint8Array([0xff, 0xd8, ...frame(0xc0, 10, 10).slice(0, 7), 0xff, 0xd9])],
    ['a JPEG cut inside a segment', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9])],
    ['a JPEG whose scan comes before its frame', new Uint8Array([0xff, 0xd8, ...scan, ...frame(0xc0, 10, 10), 0xff, 0xd9])],
    ['a JPEG ending before any frame', jpeg()],
    ['a JPEG with a second start', jpeg([0xff, 0xd8], frame(0xc0, 10, 10))],
    ['a JPEG with a byte out of place between segments', jpeg([0x00], frame(0xc0, 10, 10))],
    ['a JPEG with an escaped zero as marker', jpeg([0xff, 0x00], frame(0xc0, 10, 10))],
    ['a segment length under 2', jpeg([0xff, 0xe1, 0, 1], frame(0xc0, 10, 10))],
    ['a frame length too short for the size', jpeg([0xff, 0xc0, 0, 6, 8, 0, 10, 0, 10], frame(0xc0, 10, 10))],
    ['a width of 0', jpeg(frame(0xc0, 0, 10))],
    ['a height of 0, given later in the file', jpeg(frame(0xc0, 10, 0))],
    ['only a start', new Uint8Array([0xff, 0xd8, 0xff])],
  ])('gives nothing for %s', (_, bytes) => {
    expect(jpegSize(bytes)).toBeUndefined();
  });

  it('never throws, whatever the bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        jpegSize(bytes);
        jpegSize(new Uint8Array([0xff, 0xd8, 0xff, ...bytes, 0xff, 0xd9]));
      }),
    );
  });

  it('reads back any size it was given', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 65535 }), fc.integer({ min: 1, max: 65535 }), (width, height) => {
        expect(jpegSize(jpeg(frame(0xc0, width, height)))).toStrictEqual({ width, height });
      }),
    );
  });
});

describe('isAcceptedPhoto', () => {
  it.each([
    [256, 256],
    [256, 1],
    [1, 256],
  ])('accepts a JPEG of %i by %i', (width, height) => {
    expect(isAcceptedPhoto(jpeg(frame(0xc0, width, height)))).toBe(true);
  });

  it.each([
    [257, 256],
    [256, 257],
  ])('refuses a JPEG of %i by %i', (width, height) => {
    expect(isAcceptedPhoto(jpeg(frame(0xc0, width, height)))).toBe(false);
  });

  // Padded by comment segments, of 65 533 bytes at most each.
  const jpegOfLength = (length: number) => {
    const paddings: number[][] = [];
    let missing = length - jpeg(frame(0xc0, 10, 10)).length;
    while (missing > 0) {
      const payload = Math.min(missing - 4, 60000);
      paddings.push(
        segment(
          0xfe,
          Array.from({ length: payload }, () => 0x20),
        ),
      );
      missing -= payload + 4;
    }
    return jpeg(...paddings, frame(0xc0, 10, 10));
  };

  it('accepts MAX_PHOTO_BYTES and refuses one byte more', () => {
    expect(jpegOfLength(MAX_PHOTO_BYTES)).toHaveLength(MAX_PHOTO_BYTES);
    expect(isAcceptedPhoto(jpegOfLength(MAX_PHOTO_BYTES))).toBe(true);
    expect(jpegOfLength(MAX_PHOTO_BYTES + 1)).toHaveLength(MAX_PHOTO_BYTES + 1);
    expect(isAcceptedPhoto(jpegOfLength(MAX_PHOTO_BYTES + 1))).toBe(false);
  });

  it('refuses what is not a JPEG', () => {
    expect(isAcceptedPhoto(new TextEncoder().encode('<script>alert(1)</script>'))).toBe(false);
  });
});

describe('photoVersionSchema', () => {
  it('accepts 22 characters of base64url', () => {
    expect(photoVersionSchema.safeParse('AZaz09-_AZaz09-_AZaz09').success).toBe(true);
  });

  it.each(['AZaz09-_AZaz09-_AZaz0', 'AZaz09-_AZaz09-_AZaz09a', 'AZaz09+/AZaz09-_AZaz09', ''])('refuses %j', (version) => {
    expect(photoVersionSchema.safeParse(version).success).toBe(false);
  });
});

describe('photoUndoSchema', () => {
  const a = 'a'.repeat(22);
  const b = 'b'.repeat(22);

  it.each([
    ['a change', { version: b, previous: a }],
    ['a first photo', { version: a, previous: null }],
    ['a removal', { version: null, previous: a }],
  ])('accepts the undo of %s', (_, undo) => {
    expect(photoUndoSchema.parse(undo)).toStrictEqual(undo);
  });

  it.each([
    ['the same version twice', { version: a, previous: a }],
    ['no photo on both sides', { version: null, previous: null }],
    ['a missing field', { version: a }],
    ['an unknown field', { version: a, previous: null, member: 'alice' }],
  ])('refuses %s', (_, undo) => {
    expect(photoUndoSchema.safeParse(undo).success).toBe(false);
  });
});
