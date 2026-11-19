import { z } from 'zod';

import { memberIdSchema } from './ids.ts';

// Far above the names and titles of the group's history, and a bound on what the server stores.
const MAX_NAME_LENGTH = 50;
const MAX_GROUP_TITLE_LENGTH = 100;

export const memberSchema = z.strictObject({ id: memberIdSchema, name: z.string().min(1).max(MAX_NAME_LENGTH) });
export type Member = z.infer<typeof memberSchema>;

/** A group as the server sends it (`GET /api/groups/:token`): its title and its members, each once; operations come by the changes. */
export const groupResponseSchema = z
  .strictObject({ title: z.string().min(1).max(MAX_GROUP_TITLE_LENGTH), members: z.array(memberSchema).min(1) })
  .refine((group) => new Set(group.members.map((member) => member.id)).size === group.members.length, {
    message: 'duplicate_member',
    path: ['members'],
  });
export type GroupResponse = z.infer<typeof groupResponseSchema>;
