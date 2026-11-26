import { MAX_PHOTO_SIDE } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { centeredSquare, reductionSides } from './photo.ts';

describe('centeredSquare', () => {
  it('cuts the middle of a landscape picture, the full height kept', () => {
    expect(centeredSquare(1200, 800)).toStrictEqual({ x: 200, y: 0, side: 800 });
  });

  it('cuts the middle of a portrait picture, the full width kept', () => {
    expect(centeredSquare(3024, 4032)).toStrictEqual({ x: 0, y: 504, side: 3024 });
  });

  it('keeps a square picture whole, and rounds an odd margin down', () => {
    expect(centeredSquare(500, 500)).toStrictEqual({ x: 0, y: 0, side: 500 });
    expect(centeredSquare(501, 500)).toStrictEqual({ x: 0, y: 0, side: 500 });
    expect(centeredSquare(503, 500)).toStrictEqual({ x: 1, y: 0, side: 500 });
  });
});

describe('reductionSides', () => {
  it('halves a large square while it is more than twice the photo, then draws it at the photo size', () => {
    expect(reductionSides(3024)).toStrictEqual([1512, 756, 378, MAX_PHOTO_SIDE]);
  });

  it('draws a square up to twice the photo at once', () => {
    expect(reductionSides(512)).toStrictEqual([MAX_PHOTO_SIDE]);
    expect(reductionSides(513)).toStrictEqual([257, MAX_PHOTO_SIDE]);
  });

  it('keeps a picture smaller than the photo at its size, never enlarged', () => {
    expect(reductionSides(256)).toStrictEqual([256]);
    expect(reductionSides(120)).toStrictEqual([120]);
  });
});
