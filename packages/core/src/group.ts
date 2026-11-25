import { z } from 'zod';

import { memberIdSchema } from './ids.ts';
import { photoVersionSchema } from './photo.ts';
import { enteredTextSchema, textSchema, withoutInvisible } from './text.ts';

// Far above the names (8 characters) and the title (12) of the group's history; exported for the app's fields.
export const MAX_MEMBER_NAME_LENGTH = 50;
export const MAX_GROUP_TITLE_LENGTH = 100;

/** Most members the app may add to a group: as many as the lines of an entry (`entry.ts`), so that one expense can still be shared among all. */
export const MAX_GROUP_MEMBERS = 100;

/** Name of a member and title of a group, shared with the Tricount conversion so that an import never sends one the server rejects. */
export const memberNameSchema = textSchema(MAX_MEMBER_NAME_LENGTH);
export const groupTitleSchema = textSchema(MAX_GROUP_TITLE_LENGTH);

// Name and title as typed in the app: trimmed, then refused with a control character; the import and what is stored keep the looser schemas above.
const enteredMemberNameSchema = enteredTextSchema(MAX_MEMBER_NAME_LENGTH);
const enteredGroupTitleSchema = enteredTextSchema(MAX_GROUP_TITLE_LENGTH);

// Read and written members share their fields: the read drops a field it does not know, sent by a newer server, where the server refuses one. The
// photo is read only: the admin route refuses it, a photo changing by its own routes.
const memberShape = { id: memberIdSchema, name: memberNameSchema };

/**
 * A member as the app reads it. A field it does not know is dropped rather than refused: a server deployed with a new field still serves a phone
 * running the previous version of the app, and a copy saved on the phone before a field existed must still load, so a field added to a member later
 * is optional.
 */
export const memberSchema = z.object({ ...memberShape, photo: photoVersionSchema.optional() });
export type Member = z.infer<typeof memberSchema>;

const memberInputSchema = z.strictObject(memberShape);

// Each member once.
const membersOf = <T extends { id: string }>(member: z.ZodType<T>) =>
  z
    .array(member)
    .min(1)
    .refine((members) => new Set(members.map(({ id }) => id)).size === members.length, 'duplicate_member');

/**
 * A group as the server sends it (`GET /api/groups/:token` and the routes that edit it): its title and its members in the order they were added;
 * operations come by the changes. Tolerant of unknown fields, like `memberSchema`. `photos` tells that the instance keeps photos: without it, the
 * app offers none and no member has one.
 */
export const groupResponseSchema = z.object({ title: groupTitleSchema, members: membersOf(memberSchema), photos: z.literal(true).optional() });
export type GroupResponse = z.infer<typeof groupResponseSchema>;

/** Secret of a group's link: whoever has it reads and writes the group. Long and random, so that it cannot be guessed. */
export const groupTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);

/**
 * Group as the admin route sets it (`PUT /api/admin/groups/:id`): title, link token and members, created or updated. A member left out is kept, as
 * operations may name it; operations themselves go through the sync API.
 */
export const adminGroupSchema = z.strictObject({ title: groupTitleSchema, token: groupTokenSchema, members: membersOf(memberInputSchema) });
export type AdminGroup = z.infer<typeof adminGroupSchema>;

/** New title of a group (`PATCH /api/groups/:token`). */
export const groupUpdateSchema = z.strictObject({ title: enteredGroupTitleSchema });
export type GroupUpdate = z.infer<typeof groupUpdateSchema>;

/**
 * Member added from the app (`POST /api/groups/:token/members`), at the end of the list. Its id is drawn by the phone, so that a request sent again
 * after a lost answer finds the member it created instead of adding a second one.
 */
export const newMemberSchema = z.strictObject({ id: memberIdSchema, name: enteredMemberNameSchema });
export type NewMember = z.infer<typeof newMemberSchema>;

/** Fields of a member changed from the app (`PATCH /api/groups/:token/members/:id`), at least one; those left out stay as they are. */
export const memberUpdateSchema = z
  .strictObject({ name: enteredMemberNameSchema.optional() })
  .refine((update) => Object.values(update).some((value) => value !== undefined), 'nothing_to_update');
export type MemberUpdate = z.infer<typeof memberUpdateSchema>;

/**
 * What two names of the same group must not share, the app refusing a second member under a name already taken: the name in Unicode NFC, so that
 * an accent typed as one character or as a letter and its mark compare equal, without the characters a screen does not draw nor spaces at its
 * ends, in lower case as in French. SQLite's
 * `lower()` changes ASCII letters only, so the comparison runs here, on the server and on the phone alike.
 */
export function memberNameKey(name: string): string {
  return withoutInvisible(name.normalize('NFC')).trim().toLocaleLowerCase('fr-FR');
}
