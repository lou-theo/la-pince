import { type GroupId, MAX_GROUP_MEMBERS, type MemberId, memberNameKey, type MemberUpdate, type NewMember } from '@la-pince/core';

// The group's members as one value, ordered by id: read before judging an edit, then compared again inside the statement that writes it, so that the
// write happens only if no member was added or renamed in between; no migration needed. Raw SQL, as in `store.ts`; names follow `schema.ts`.
const MEMBERS_SNAPSHOT = '(SELECT json_group_array(json_array(m.id, m.name) ORDER BY m.id) FROM members AS m WHERE m.group_id = ?1)';

// Each try lost means another edit of the group was written in between, so tries run out only under a flood of edits.
const MAX_TRIES = 10;

/** The members of a group as read before an edit, and the snapshot the edit's statement compares against. */
export interface MembersRead {
  readonly snapshot: string;
  readonly members: readonly { readonly id: string; readonly name: string }[];
}

export async function readMembers(db: D1Database, groupId: GroupId): Promise<MembersRead> {
  const row = await db.prepare(`SELECT ${MEMBERS_SNAPSHOT} AS snapshot`).bind(groupId).first<{ snapshot: string }>();
  // An aggregate always gives one row, `[]` for a group without members.
  /* v8 ignore next */
  const snapshot = row?.snapshot ?? '[]';
  return { snapshot, members: (JSON.parse(snapshot) as [string, string][]).map(([id, name]) => ({ id, name })) };
}

// Whether another member than `self` already has this name.
const nameTaken = (read: MembersRead, name: string, self: string) =>
  read.members.some((member) => member.id !== self && memberNameKey(member.name) === memberNameKey(name));

export type AddOutcome = 'added' | 'replayed' | 'too_many_members' | 'member_name_taken';

/**
 * Adds a member at the end of the list, judged on `read`. A member already there under the same id is a replay after a lost answer: left as it is,
 * renamed since or not, even in a full group. A write kept out by a concurrent edit is judged again on a fresh read.
 */
export async function addMember(db: D1Database, groupId: GroupId, member: NewMember, read: MembersRead): Promise<AddOutcome> {
  let current = read;
  for (let tries = 0; tries < MAX_TRIES; tries += 1) {
    if (current.members.some(({ id }) => id === member.id)) {
      return 'replayed';
    }
    if (current.members.length >= MAX_GROUP_MEMBERS) {
      return 'too_many_members';
    }
    if (nameTaken(current, member.name, member.id)) {
      return 'member_name_taken';
    }
    // SQLite needs a `WHERE` in the `SELECT` of an `INSERT … SELECT … ON CONFLICT`. The position is computed in the statement, and the snapshot keeps
    // the cap and the name judged above true: D1 runs a database's statements one after the other.
    const inserted = await db
      .prepare(
        `INSERT INTO members (group_id, id, name, position)
         SELECT ?1, ?2, ?3, COALESCE((SELECT MAX(position) FROM members WHERE group_id = ?1), -1) + 1
         WHERE ${MEMBERS_SNAPSHOT} = ?4
         ON CONFLICT DO NOTHING RETURNING id`,
      )
      .bind(groupId, member.id, member.name, current.snapshot)
      .first();
    if (inserted !== null) {
      return 'added';
    }
    current = await readMembers(db, groupId);
  }
  // Only under a flood of edits of the same group.
  /* v8 ignore next */
  throw new Error('member not added: the group changed at each try');
}

export type UpdateOutcome = 'updated' | 'member_not_found' | 'member_name_taken';

/**
 * Changes a member's fields, judged on `read`; a member of another group is not found, members being looked up within the group of the link. A
 * member may take its own name with another case. Two renamings of the same member: the last one written wins.
 */
export async function updateMember(db: D1Database, groupId: GroupId, id: MemberId, update: MemberUpdate, read: MembersRead): Promise<UpdateOutcome> {
  let current = read;
  for (let tries = 0; tries < MAX_TRIES; tries += 1) {
    if (!current.members.some((member) => member.id === id)) {
      return 'member_not_found';
    }
    if (update.name !== undefined && nameTaken(current, update.name, id)) {
      return 'member_name_taken';
    }
    const updated = await db
      .prepare(`UPDATE members SET name = COALESCE(?3, name) WHERE group_id = ?1 AND id = ?2 AND ${MEMBERS_SNAPSHOT} = ?4 RETURNING id`)
      .bind(groupId, id, update.name ?? null, current.snapshot)
      .first();
    if (updated !== null) {
      return 'updated';
    }
    current = await readMembers(db, groupId);
  }
  // Only under a flood of edits of the same group.
  /* v8 ignore next */
  throw new Error('member not updated: the group changed at each try');
}
