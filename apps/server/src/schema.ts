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
