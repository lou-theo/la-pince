import { z } from 'zod';

/** Identifier of a member, created on the phone that adds the member. */
export const memberIdSchema = z.string().min(1).brand('MemberId');
export type MemberId = z.infer<typeof memberIdSchema>;

/** Identifier of an operation, created on the phone that enters it, so that a replayed send never creates a duplicate. */
export const operationIdSchema = z.string().min(1).brand('OperationId');
export type OperationId = z.infer<typeof operationIdSchema>;

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
