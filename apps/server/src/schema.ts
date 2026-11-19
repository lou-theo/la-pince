import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  // SHA-256 of the link's token, so that reading the database does not give access to the groups.
  tokenHash: text('token_hash').notNull().unique(),
  title: text('title').notNull(),
});

export const members = sqliteTable(
  'members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    id: text('id').notNull(),
    name: text('name').notNull(),
    // Order in which members were added, which the phone uses to break ties when it orders members.
    position: integer('position').notNull(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.id] })],
);

// Every revision received, kept to recover an overwritten change; `seq` is the counter of the sync, shared by all groups, given again only after
// the database is restored to an earlier point, which the read of the changes detects (`unknown_cursor`).
export const revisions = sqliteTable('revisions', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  revisionId: text('revision_id').notNull().unique(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id),
  operationId: text('operation_id').notNull(),
  // The revision as parsed by `operationSchema`, in JSON.
  content: text('content').notNull(),
});

// Current state of each operation: its last revision written. An operation id belongs to a single group.
export const operations = sqliteTable(
  'operations',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    seq: integer('seq').notNull(),
    createdSeq: integer('created_seq').notNull(),
    content: text('content').notNull(),
  },
  (table) => [index('operations_changes').on(table.groupId, table.seq)],
);

// Push subscription of a phone to a group's notifications, as the member it said it was; one per phone and group, since the endpoint names the
// phone's browser. Removed when the phone stops it or when its push service says it is gone.
export const subscriptions = sqliteTable(
  'subscriptions',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    endpoint: text('endpoint').notNull(),
    memberId: text('member_id').notNull(),
    // Public key of the phone and authentication secret, in base64url: what the server encrypts each message with.
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.endpoint] }),
    index('subscriptions_members').on(table.groupId, table.memberId),
    index('subscriptions_endpoint').on(table.endpoint),
  ],
);
