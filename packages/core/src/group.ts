import { z } from 'zod';

import { memberIdSchema } from './ids.ts';
import { textSchema } from './text.ts';

// Far above the names (8 characters) and the title (12) of the group's history.
const MAX_NAME_LENGTH = 50;
const MAX_GROUP_TITLE_LENGTH = 100;

/** Name of a member and title of a group, shared with the Tricount conversion so that an import never sends one the server rejects. */
export const memberNameSchema = textSchema(MAX_NAME_LENGTH);
export const groupTitleSchema = textSchema(MAX_GROUP_TITLE_LENGTH);

export const memberSchema = z.strictObject({ id: memberIdSchema, name: memberNameSchema });
export type Member = z.infer<typeof memberSchema>;

/** A group as the server sends it (`GET /api/groups/:token`): its title and its members, each once; operations come by the changes. */
export const groupResponseSchema = z
  .strictObject({ title: groupTitleSchema, members: z.array(memberSchema).min(1) })
  .refine((group) => new Set(group.members.map((member) => member.id)).size === group.members.length, {
    message: 'duplicate_member',
    path: ['members'],
  });
export type GroupResponse = z.infer<typeof groupResponseSchema>;
