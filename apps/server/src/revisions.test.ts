import {
  type GroupId,
  groupIdSchema,
  type MemberId,
  memberIdSchema,
  type OperationId,
  operationIdSchema,
  type RevisionId,
  revisionIdSchema,
} from '@la-pince/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type BatchContext, decideRevisions, type StoredRevision } from './revisions.ts';

const trip = groupIdSchema.parse('trip');
const other = groupIdSchema.parse('other');
const revisionId = (value: string): RevisionId => revisionIdSchema.parse(value);

const revision = (id: string, rev: string, change: { total: number } | { deleted: true } | { payer: string } = { total: 1000 }) => ({
  revisionId: revisionId(rev),
  raw: {
    id,
    revisionId: rev,
    title: 'Groceries',
    date: '2026-11-16',
    ...('deleted' in change
      ? change
      : {
          entry: {
            version: 1,
            kind: 'expense',
            payer: 'payer' in change ? change.payer : 'alice',
            lines: [{ member: 'bob', amount: 'total' in change ? change.total : 1000 }],
          },
        }),
  },
});

const context = ({
  storedRevisions = new Map<RevisionId, StoredRevision>(),
  operationGroups = new Map<OperationId, GroupId>(),
}: Partial<BatchContext> = {}): BatchContext => ({
  groupId: trip,
  members: new Set<MemberId>(['alice', 'bob'].map((member) => memberIdSchema.parse(member))),
  storedRevisions,
  operationGroups,
});

const statuses = (decisions: ReturnType<typeof decideRevisions>) =>
  decisions.map((decision) => (decision.status === 'rejected' ? `rejected:${decision.reason}` : decision.status));

describe('decideRevisions', () => {
  it('writes new revisions in the order sent', () => {
    const decisions = decideRevisions([revision('op1', 'rev1'), revision('op1', 'rev2', { total: 2000 })], context());
    expect(statuses(decisions)).toStrictEqual(['write', 'write']);
    expect(decisions[1]).toMatchObject({ status: 'write', operation: { id: 'op1', revisionId: 'rev2' } });
  });

  it('answers a resend of a revision already received, with the same content, as a duplicate', () => {
    const sent = revision('op1', 'rev1');
    const [written] = decideRevisions([sent], context());
    const stored = new Map([[revisionId('rev1'), { groupId: trip, content: written?.status === 'write' ? written.content : '' }]]);
    expect(statuses(decideRevisions([sent], context({ storedRevisions: stored })))).toStrictEqual(['duplicate']);
  });

  it('refuses a revision id received with another content, or in another group', () => {
    const [written] = decideRevisions([revision('op1', 'rev1')], context());
    const content = written?.status === 'write' ? written.content : '';
    expect(
      statuses(
        decideRevisions(
          [revision('op1', 'rev1', { total: 5 })],
          context({ storedRevisions: new Map([[revisionId('rev1'), { groupId: trip, content }]]) }),
        ),
      ),
    ).toStrictEqual(['rejected:revision_conflict']);
    expect(
      statuses(
        decideRevisions([revision('op1', 'rev1')], context({ storedRevisions: new Map([[revisionId('rev1'), { groupId: other, content }]]) })),
      ),
    ).toStrictEqual(['rejected:revision_conflict']);
  });

  it('judges a revision repeated in the batch against its first occurrence', () => {
    const decisions = decideRevisions([revision('op1', 'rev1'), revision('op1', 'rev1'), revision('op1', 'rev1', { total: 5 })], context());
    expect(statuses(decisions)).toStrictEqual(['write', 'duplicate', 'rejected:revision_conflict']);
  });

  it('rejects each faulty revision on its own and writes the others', () => {
    const decisions = decideRevisions(
      [
        revision('op1', 'rev1'),
        revision('op2', 'rev2', { payer: 'mallory' }),
        { revisionId: revisionId('rev3'), raw: { ...revision('op3', 'rev3').raw, effect: {} } },
        revision('op4', 'rev4'),
      ],
      context(),
    );
    expect(statuses(decisions)).toStrictEqual(['write', 'rejected:unknown_member', 'rejected:invalid_operation', 'write']);
  });

  it('refuses an operation id that belongs to another group, and accepts one of the group', () => {
    const operationGroups = new Map([
      [operationIdSchema.parse('op1'), other],
      [operationIdSchema.parse('op2'), trip],
    ]);
    expect(statuses(decideRevisions([revision('op1', 'rev1'), revision('op2', 'rev2')], context({ operationGroups })))).toStrictEqual([
      'rejected:operation_in_other_group',
      'write',
    ]);
  });

  it('writes the mark of a deleted operation', () => {
    expect(statuses(decideRevisions([revision('op1', 'rev1', { deleted: true })], context()))).toStrictEqual(['write']);
  });

  // The outbox resends any revision it is not sure arrived, in later batches; the server must write each revision once, in the order it first
  // arrived, and answer every resend as a duplicate.
  const sends = fc
    .array(fc.record({ operation: fc.constantFrom('op1', 'op2', 'op3'), deleted: fc.boolean() }), { minLength: 1, maxLength: 20 })
    .map((changes) =>
      changes.map(({ operation, deleted }, index) => revision(operation, `rev${String(index)}`, deleted ? { deleted: true } : { total: index + 1 })),
    )
    .chain((revisions) =>
      fc.tuple(
        fc.constant(revisions),
        fc.array(fc.array(fc.nat({ max: revisions.length - 1 }), { maxLength: 5 }), { minLength: revisions.length, maxLength: revisions.length }),
        fc.integer({ min: 1, max: 50 }),
      ),
    );

  it('writes each revision once, in the order it first arrived, whatever is replayed', () => {
    fc.assert(
      fc.property(sends, ([revisions, replays, batchSize]) => {
        const stream = revisions.flatMap((sent, index) => [
          sent,
          ...(replays[index] ?? []).filter((replayed) => replayed <= index).flatMap((replayed) => revisions[replayed] ?? []),
        ]);
        const storedRevisions = new Map<RevisionId, StoredRevision>();
        const written: RevisionId[] = [];
        for (let start = 0; start < stream.length; start += batchSize) {
          for (const decision of decideRevisions(stream.slice(start, start + batchSize), context({ storedRevisions }))) {
            expect(decision.status).not.toBe('rejected');
            if (decision.status === 'write') {
              storedRevisions.set(decision.revisionId, { groupId: trip, content: decision.content });
              written.push(decision.revisionId);
            }
          }
        }
        expect(written).toStrictEqual(revisions.map((sent) => sent.revisionId));
      }),
    );
  });
});
