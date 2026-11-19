import { z } from 'zod';

// ASCII letters, digits, `-` and `_`, as in a UUID or a Tricount identifier, 64 at most: an identifier must come back from storage unchanged, since
// it seeds the leftover cent and orders members, which a lone surrogate replaced on the way to UTF-8 would not; the length bounds what the server stores.
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Identifier of a member, created on the phone that adds the member. */
export const memberIdSchema = idSchema.brand('MemberId');
export type MemberId = z.infer<typeof memberIdSchema>;

/** Identifier of an operation, created on the phone that enters it, so that a replayed send never creates a duplicate. */
export const operationIdSchema = idSchema.brand('OperationId');
export type OperationId = z.infer<typeof operationIdSchema>;

/** Identifier of a revision of an operation, created on the phone with each change, so that a replayed send never writes a revision twice. */
export const revisionIdSchema = idSchema.brand('RevisionId');
export type RevisionId = z.infer<typeof revisionIdSchema>;

/**
 * Orders identifiers by UTF-16 code units. Phone and server must order members the same way for the leftover cent to go to the same member,
 * which `localeCompare` does not guarantee across runtimes and locales.
 */
export function compareIds(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
