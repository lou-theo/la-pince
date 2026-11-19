import {
  type GroupId,
  type MemberId,
  type Operation,
  type OperationId,
  operationSchema,
  type RejectionReason,
  type RevisionId,
  unknownMembers,
} from '@la-pince/core';

/** A revision as the database keeps it: its group and its content in canonical JSON. */
export interface StoredRevision {
  readonly groupId: GroupId;
  readonly content: string;
}

/** What the batch's revisions meet in the database: the group's members, the revisions already received, and the group of each known operation. */
export interface BatchContext {
  readonly groupId: GroupId;
  readonly members: ReadonlySet<MemberId>;
  readonly storedRevisions: ReadonlyMap<RevisionId, StoredRevision>;
  readonly operationGroups: ReadonlyMap<OperationId, GroupId>;
}

export type Decision =
  | { readonly revisionId: RevisionId; readonly status: 'write'; readonly operation: Operation; readonly content: string }
  | { readonly revisionId: RevisionId; readonly status: 'duplicate' }
  | { readonly revisionId: RevisionId; readonly status: 'rejected'; readonly reason: RejectionReason };

/** JSON with object keys sorted, so that two equal revisions give the same text whatever the order their fields came in. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, nested: unknown) =>
    nested !== null && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.fromEntries(Object.entries(nested).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : nested,
  );
}

/**
 * Decides, in the order sent, what becomes of each revision of a batch: written, a resend of a revision already received with the same content in
 * the same group, or rejected with its reason. A revision is judged on its own, so that one refusal never holds back the others; a revision met
 * earlier in the batch counts as received.
 */
export function decideRevisions(batch: readonly { readonly revisionId: RevisionId; readonly raw: unknown }[], context: BatchContext): Decision[] {
  const received = new Map(context.storedRevisions);
  return batch.map(({ revisionId, raw }): Decision => {
    const parsed = operationSchema.safeParse(raw);
    if (!parsed.success) {
      return { revisionId, status: 'rejected', reason: 'invalid_operation' };
    }
    const operation = parsed.data;
    const content = canonicalJson(operation);
    const stored = received.get(revisionId);
    if (stored !== undefined) {
      return stored.groupId === context.groupId && stored.content === content
        ? { revisionId, status: 'duplicate' }
        : { revisionId, status: 'rejected', reason: 'revision_conflict' };
    }
    const owner = context.operationGroups.get(operation.id);
    if (owner !== undefined && owner !== context.groupId) {
      return { revisionId, status: 'rejected', reason: 'operation_in_other_group' };
    }
    if (unknownMembers(operation, context.members).length > 0) {
      return { revisionId, status: 'rejected', reason: 'unknown_member' };
    }
    received.set(revisionId, { groupId: context.groupId, content });
    return { revisionId, status: 'write', operation, content };
  });
}
