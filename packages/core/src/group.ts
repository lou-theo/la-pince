import { z } from 'zod';

import { memberIdSchema } from './ids.ts';
import { textSchema } from './text.ts';

// Far above the names (8 characters) and the title (12) of the group's history.
const MAX_NAME_LENGTH = 50;
const MAX_GROUP_TITLE_LENGTH = 100;

/** Name of a member and title of a group, shared with the Tricount conversion so that an import never sends one the server rejects. */
export const memberNameSchema = textSchema(MAX_NAME_LENGTH);
export const groupTitleSchema = textSchema(MAX_GROUP_TITLE_LENGTH);

// Read and written members share their fields: the read drops a field it does not know, sent by a newer server, where the server refuses one.
const memberShape = { id: memberIdSchema, name: memberNameSchema };

/**
 * A member as the app reads it. A field it does not know is dropped rather than refused: a server deployed with a new field still serves a phone
 * running the previous version of the app, and a copy saved on the phone before a field existed must still load, so a field added to a member later
 * is optional.
 */
export const memberSchema = z.object(memberShape);
export type Member = z.infer<typeof memberSchema>;

const memberInputSchema = z.strictObject(memberShape);

// Each member once.
const membersOf = <T extends { id: string }>(member: z.ZodType<T>) =>
  z
    .array(member)
    .min(1)
    .refine((members) => new Set(members.map(({ id }) => id)).size === members.length, 'duplicate_member');

/**
 * A group as the server sends it (`GET /api/groups/:token`): its title and its members in the order they were added; operations come by the changes.
 * Tolerant of unknown fields, like `memberSchema`.
 */
export const groupResponseSchema = z.object({ title: groupTitleSchema, members: membersOf(memberSchema) });
export type GroupResponse = z.infer<typeof groupResponseSchema>;

/** Secret of a group's link: whoever has it reads and writes the group. Long and random, so that it cannot be guessed. */
export const groupTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);

/**
 * Group as the admin route sets it (`PUT /api/admin/groups/:id`): title, link token and members, created or updated. A member left out is kept, as
 * operations may name it; operations themselves go through the sync API.
 */
export const adminGroupSchema = z.strictObject({ title: groupTitleSchema, token: groupTokenSchema, members: membersOf(memberInputSchema) });
export type AdminGroup = z.infer<typeof adminGroupSchema>;
