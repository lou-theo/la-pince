import { z } from 'zod';

/** Text typed by a person (title, name): not empty, at most `maxLength` UTF-16 code units, and well formed, so that storage in UTF-8 keeps it intact. */
export function textSchema(maxLength: number): z.ZodString {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((text) => text.isWellFormed(), 'malformed_text');
}
