import { z } from 'zod';

// A lone surrogate, which UTF-8 cannot carry: storage would bring the text back changed. Matched by regex rather than `isWellFormed`, too recent
// for the older phones the app runs on.
const LONE_SURROGATE = /\p{Cs}/u;

// A line break, a tab or another control character, which a one-line field never holds, or an invisible format character (a zero-width space
// would make a name look empty, or look like another and pass as a different name). Emoji keep the joiner and the tags that build them.
const CONTROL_CHARACTER = /(?![\u200D\u{E0020}-\u{E007F}])[\p{Cc}\p{Cf}]/u;

/** Text typed by a person (title, name): not empty, at most `maxLength` UTF-16 code units, and well formed, so that storage in UTF-8 keeps it intact. */
export function textSchema(maxLength: number): z.ZodString {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((text) => !LONE_SURROGATE.test(text), 'malformed_text');
}

/**
 * Text a phone sends to be stored as typed (a title, a name edited in the app): spaces at both ends removed, then judged as `textSchema`, control
 * and invisible characters refused. Stricter than `textSchema`, which also reads what was stored before, by the import among others.
 */
export function enteredTextSchema(maxLength: number): z.ZodPipe<z.ZodString, z.ZodString> {
  return z
    .string()
    .trim()
    .pipe(textSchema(maxLength).refine((text) => !CONTROL_CHARACTER.test(text), 'control_character'));
}
