import { MAX_PHOTO_SIDE } from '@la-pince/core';

/** The square a picture is cut to, centered on it: its left and top edges in the picture, and its side, in the picture's pixels. */
export interface Square {
  readonly x: number;
  readonly y: number;
  readonly side: number;
}

/** The largest square centered on a picture of `width` × `height`: the face of a portrait or of a group shot is most often near the middle. */
export function centeredSquare(width: number, height: number): Square {
  const side = Math.min(width, height);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side };
}

/**
 * The sides the square goes through on its way to `MAX_PHOTO_SIDE`, the last one being the photo's: halved while more than twice too large, since
 * one smoothed drawing that shrinks more than about four times skips pixels and leaves a grainy picture. A picture smaller than the photo stays as
 * it is.
 */
export function reductionSides(side: number): number[] {
  const target = Math.min(side, MAX_PHOTO_SIDE);
  const sides: number[] = [];
  let current = side;
  while (current > target * 2) {
    current = Math.round(current / 2);
    sides.push(current);
  }
  sides.push(target);
  return sides;
}

/** Qualities the JPEG is encoded at, one after the other, until it weighs what the server takes: a 256 px face fits at the first in practice. */
export const JPEG_QUALITIES = [0.85, 0.7, 0.5] as const;
