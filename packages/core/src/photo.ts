import { z } from 'zod';

/** Largest photo the server keeps, in bytes: a 256 px JPEG of a face weighs a few tens of KB, so only a bug or a forged client reaches it. */
export const MAX_PHOTO_BYTES = 200 * 1024;
/** Longest side of a photo, in pixels: the phone crops and reduces any picture to this square before sending it. */
export const MAX_PHOTO_SIDE = 256;

/**
 * Version of a member's photo: the first 16 bytes of the SHA-256 of its JPEG, in base64url, drawn by the server. It names the stored photo and its
 * address, which never change, so that a copy kept anywhere is never stale and sending the same photo again is recognized.
 */
export const photoVersionSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22}$/)
  .brand('PhotoVersion');
export type PhotoVersion = z.infer<typeof photoVersionSchema>;

/**
 * Undo of a photo change (`POST /api/groups/:token/members/:id/photo/undo`), sent by the phone that made it: the version it set (`null` after a
 * removal) and the one it replaced (`null` when the member had none). The server puts `previous` back only while `version` is still the photo.
 */
export const photoUndoSchema = z
  .strictObject({ version: photoVersionSchema.nullable(), previous: photoVersionSchema.nullable() })
  .refine((undo) => undo.version !== undo.previous, 'nothing_to_undo');
export type PhotoUndo = z.infer<typeof photoUndoSchema>;

// Start-of-frame markers, which carry the size of the picture: C4 (Huffman tables), C8 (reserved) and CC (arithmetic coding) are other segments.
const START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const START_OF_SCAN = 0xda;
// Markers without a length: TEM and the restart markers.
const standalone = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

/**
 * Width and height of a JPEG, read from its first start-of-frame segment, or `undefined` when the bytes do not start and end as a JPEG, end before
 * that segment, reach the image data first, or give a side of 0 (a height given later in the file, which no phone writes). Never throws, whatever
 * the bytes; the image data itself is not decoded.
 */
export function jpegSize(bytes: Uint8Array): { readonly width: number; readonly height: number } | undefined {
  const at = (index: number) => bytes[index] ?? -1;
  const word = (index: number) => at(index) * 256 + at(index + 1);
  if (at(0) !== 0xff || at(1) !== 0xd8 || at(2) !== 0xff || at(bytes.length - 2) !== 0xff || at(bytes.length - 1) !== 0xd9) {
    return undefined;
  }
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (at(offset) !== 0xff) {
      return undefined;
    }
    const marker = at(offset + 1);
    if (marker === 0xff) {
      // Fill byte before a marker.
      offset += 1;
    } else if (standalone(marker)) {
      offset += 2;
    } else if (marker === START_OF_SCAN || marker === 0xd8 || marker === 0xd9 || marker === 0x00) {
      return undefined;
    } else if (START_OF_FRAME.has(marker)) {
      // Length (2 bytes), precision (1), height (2), width (2): the segment must hold them, and the file must hold the segment.
      const length = word(offset + 2);
      if (length < 7 || offset + 2 + length > bytes.length) {
        return undefined;
      }
      const height = word(offset + 5);
      const width = word(offset + 7);
      return height === 0 || width === 0 ? undefined : { width, height };
    } else {
      const length = word(offset + 2);
      if (length < 2) {
        return undefined;
      }
      offset += 2 + length;
    }
  }
  return undefined;
}

/** Whether the server keeps these bytes as a photo: a JPEG of `MAX_PHOTO_BYTES` at most, neither side over `MAX_PHOTO_SIDE`. */
export function isAcceptedPhoto(bytes: Uint8Array): boolean {
  if (bytes.length > MAX_PHOTO_BYTES) {
    return false;
  }
  const size = jpegSize(bytes);
  return size !== undefined && size.width <= MAX_PHOTO_SIDE && size.height <= MAX_PHOTO_SIDE;
}
