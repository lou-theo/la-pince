import { memberIdSchema } from '@la-pince/core';

import { openGroupDb } from '../storage/groupDb.ts';

/** Remembers on this phone who I am in the group of a link, as if chosen on an earlier visit. */
export async function rememberMember(token: string, member: string): Promise<void> {
  const db = await openGroupDb(token);
  await db.saveCurrentMember(memberIdSchema.parse(member));
}
