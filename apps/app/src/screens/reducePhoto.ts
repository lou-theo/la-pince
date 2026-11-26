import { isAcceptedPhoto } from '@la-pince/core';

import { centeredSquare, JPEG_QUALITIES, reductionSides } from '../model/photo.ts';

/**
 * Why a picture could not become a photo: `unreadable`, the browser cannot decode it (a HEIC picture outside Safari, a file that is no picture);
 * `not_encoded`, the browser did not give a JPEG the server takes (one that cannot encode JPEG gives PNG without a word).
 */
export type ReduceError = 'unreadable' | 'not_encoded';
export type ReduceResult = { readonly ok: true; readonly photo: Blob } | { readonly ok: false; readonly error: ReduceError };

interface Decoded {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  readonly close: () => void;
}

/** The picture decoded, turned as its EXIF orientation says, or `undefined`; by `createImageBitmap`, else by an image element for older browsers. */
async function decode(file: Blob): Promise<Decoded | undefined> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => {
        bitmap.close();
      },
    };
  } catch {
    // Not decoded this way (a browser without it, an option it does not know): the image element may still decode it.
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image.naturalWidth === 0 ? undefined : { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => undefined };
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });

/**
 * A picture chosen on the phone made into the photo the server keeps: the square at its middle, reduced to `MAX_PHOTO_SIDE`, encoded as a JPEG of
 * `MAX_PHOTO_BYTES` at most, without its EXIF (position included). A transparent picture gets a white background, which JPEG has not.
 */
export async function reducePhoto(file: Blob): Promise<ReduceResult> {
  const decoded = await decode(file);
  if (decoded === undefined || decoded.width === 0 || decoded.height === 0) {
    return { ok: false, error: 'unreadable' };
  }
  let canvas: HTMLCanvasElement | undefined;
  try {
    const square = centeredSquare(decoded.width, decoded.height);
    let source = decoded.source;
    let from = square;
    for (const side of reductionSides(square.side)) {
      const next = document.createElement('canvas');
      next.width = side;
      next.height = side;
      const context = next.getContext('2d');
      if (context === null) {
        return { ok: false, error: 'not_encoded' };
      }
      context.fillStyle = '#fff';
      context.fillRect(0, 0, side, side);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, from.x, from.y, from.side, from.side, 0, 0, side, side);
      canvas = next;
      source = next;
      from = { x: 0, y: 0, side };
    }
  } finally {
    decoded.close();
  }
  if (canvas === undefined) {
    return { ok: false, error: 'not_encoded' };
  }
  for (const quality of JPEG_QUALITIES) {
    const blob = await toBlob(canvas, quality);
    if (blob?.type !== 'image/jpeg') {
      return { ok: false, error: 'not_encoded' };
    }
    if (isAcceptedPhoto(new Uint8Array(await blob.arrayBuffer()))) {
      return { ok: true, photo: blob };
    }
  }
  return { ok: false, error: 'not_encoded' };
}
