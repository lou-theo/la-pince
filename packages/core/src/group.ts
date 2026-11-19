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

// Each member once.
const membersSchema = z
  .array(memberSchema)
  .min(1)
  .refine((members) => new Set(members.map((member) => member.id)).size === members.length, 'duplicate_member');

/** A group as the server sends it (`GET /api/groups/:token`): its title and its members in the order they were added; operations come by the changes. */
export const groupResponseSchema = z.strictObject({ title: groupTitleSchema, members: membersSchema });
export type GroupResponse = z.infer<typeof groupResponseSchema>;

/** Secret of a group's link: whoever has it reads and writes the group. Long and random, so that it cannot be guessed. */
export const groupTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);

/**
 * Group as the admin route sets it (`PUT /api/admin/groups/:id`): title, link token and members, created or updated. A member left out is kept, as
 * operations may name it; operations themselves go through the sync API.
 */
export const adminGroupSchema = z.strictObject({ title: groupTitleSchema, token: groupTokenSchema, members: membersSchema });
export type AdminGroup = z.infer<typeof adminGroupSchema>;
