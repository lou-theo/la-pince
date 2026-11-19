import { z } from 'zod';

// A lone surrogate, which UTF-8 cannot carry: storage would bring the text back changed. Matched by regex rather than `isWellFormed`, too recent
// for the older phones the app runs on.
const LONE_SURROGATE = /\p{Cs}/u;

/** Text typed by a person (title, name): not empty, at most `maxLength` UTF-16 code units, and well formed, so that storage in UTF-8 keeps it intact. */
export function textSchema(maxLength: number): z.ZodString {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((text) => !LONE_SURROGATE.test(text), 'malformed_text');
}
