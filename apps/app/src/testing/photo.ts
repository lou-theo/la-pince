import { vi } from 'vitest';

const segment = (marker: number, payload: readonly number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];

/**
 * A synthetic JPEG of `side` × `side` as the server checks it (signature and frame), `seed` in a comment so that two photos differ; its image data
 * is not decodable.
 */
export function syntheticJpeg(seed: number, side = 256): Uint8Array<ArrayBuffer> {
  const frame = segment(0xc0, [8, side >> 8, side & 0xff, side >> 8, side & 0xff, 3, 1, 0x22, 0]);
  return new Uint8Array([0xff, 0xd8, ...segment(0xfe, [seed & 0xff]), ...frame, ...segment(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34, 0xff, 0xd9]);
}

/**
 * The browser's decoding and canvas, which happy-dom has not: a picture decodes as `width` × `height` (or fails, `decodes: false`), and the canvas
 * encodes to the bytes `encode` gives for each quality, as `type`. Gives the sides of the canvases drawn and the qualities asked; undone by
 * `vi.restoreAllMocks` and `vi.unstubAllGlobals`.
 */
export function stubPicture({
  width = 1200,
  height = 800,
  decodes = true,
  encode = () => syntheticJpeg(1),
  type = 'image/jpeg',
}: {
  width?: number;
  height?: number;
  decodes?: boolean;
  encode?: (quality: number) => Uint8Array<ArrayBuffer>;
  type?: string;
} = {}): { readonly drawn: number[]; readonly qualities: number[] } {
  const drawn: number[] = [];
  const qualities: number[] = [];
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => (decodes ? Promise.resolve({ width, height, close: () => undefined }) : Promise.reject(new DOMException('', 'InvalidStateError')))),
  );
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockRejectedValue(new DOMException('', 'EncodingError'));
  const context = {
    fillRect: () => undefined,
    drawImage: () => undefined,
    fillStyle: '',
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    drawn.push(this.width);
    return context as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback, _type?: string, quality?: number) => {
    qualities.push(quality ?? 1);
    callback(new Blob([encode(quality ?? 1)], { type }));
  });
  return { drawn, qualities };
}
