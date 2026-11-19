import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type OperationId, type RevisionId, revisionIdSchema } from './ids.ts';
import { type Operation, operationSchema } from './operation.ts';
import {
  changesQuerySchema,
  changesResponseSchema,
  MAX_BATCH_REVISIONS,
  MAX_CHANGES,
  newRevisions,
  operationBatchSchema,
  pageFollowsQuery,
} from './sync.ts';

const revision = (id: string, revisionId: string, change: { total: number } | { deleted: true } = { total: 1000 }): Operation =>
  operationSchema.parse({
    id,
    revisionId,
    title: 'Groceries',
    date: '2026-11-16',
    ...('deleted' in change ? change : { entry: { version: 1, kind: 'expense', payer: 'alice', lines: [{ member: 'bob', amount: change.total }] } }),
  });
const received = (...revisionIds: string[]): Set<RevisionId> => new Set(revisionIds.map((revisionId) => revisionIdSchema.parse(revisionId)));

// What the server keeps as the current state of each operation: the last revision written, as `operations` will in D1.
const currentState = (written: readonly Operation[]): Map<OperationId, Operation> => new Map(written.map((operation) => [operation.id, operation]));

describe('operationBatchSchema', () => {
  it(`accepts from 1 to ${String(MAX_BATCH_REVISIONS)} revisions, in the order sent`, () => {
    const operations = Array.from({ length: MAX_BATCH_REVISIONS }, (_, index) => revision(`op${String(index)}`, `rev${String(index)}`));
    expect(operationBatchSchema.parse({ operations }).operations).toStrictEqual(operations);
  });

  it.each([
    ['an empty batch', { operations: [] }],
    ['a batch over the limit', { operations: Array.from({ length: MAX_BATCH_REVISIONS + 1 }, () => revision('op1', 'rev1')) }],
    ['a batch with an invalid revision', { operations: [revision('op1', 'rev1'), { id: 'op2' }] }],
    ['an unknown field', { operations: [revision('op1', 'rev1')], since: 0 }],
  ])('rejects %s', (_, batch) => {
    expect(operationBatchSchema.safeParse(batch).success).toBe(false);
  });
});

describe('changesQuerySchema', () => {
  it('reads from the start, a full page, when the phone gives neither parameter', () => {
    expect(changesQuerySchema.parse({})).toStrictEqual({ since: 0, limit: MAX_CHANGES });
  });

  it('reads the cursor and the page size from the query strings, ignoring other parameters', () => {
    expect(changesQuerySchema.parse({ since: '42', limit: '10', cache: '1' })).toStrictEqual({ since: 42, limit: 10 });
  });

  it.each([
    ['a negative cursor', { since: '-1' }],
    ['a cursor in exponent notation', { since: '1e3' }],
    ['a hexadecimal cursor', { since: '0x10' }],
    ['an empty cursor', { since: '' }],
    ['a decimal cursor', { since: '1.5' }],
    ['a page of zero', { limit: '0' }],
    ['a page over the limit', { limit: String(MAX_CHANGES + 1) }],
  ])('rejects %s', (_, query) => {
    expect(changesQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('changesResponseSchema', () => {
  const change = (seq: number, deleted = false) => ({
    ...revision(`op${String(seq)}`, `rev${String(seq)}`, deleted ? { deleted: true } : undefined),
    seq,
  });

  it('accepts a page of current revisions by increasing seq, the cursor on the last one', () => {
    const page = { changes: [change(3), change(7, true)], cursor: 7, hasMore: true };
    expect(changesResponseSchema.parse(page)).toStrictEqual(page);
  });

  it('accepts an empty last page that leaves the cursor where it was', () => {
    expect(changesResponseSchema.parse({ changes: [], cursor: 12, hasMore: false })).toStrictEqual({ changes: [], cursor: 12, hasMore: false });
  });

  it.each([
    ['a negative cursor', { changes: [], cursor: -1, hasMore: false }],
    [
      'a page over the limit',
      { changes: Array.from({ length: MAX_CHANGES + 1 }, (_, index) => change(index + 1)), cursor: MAX_CHANGES + 1, hasMore: true },
    ],
    ['a missing hasMore', { changes: [], cursor: 0 }],
    ['a change without seq', { changes: [revision('op1', 'rev1')], cursor: 1, hasMore: false }],
    ['a seq of zero', { changes: [change(0)], cursor: 0, hasMore: false }],
    ['changes out of order', { changes: [change(7), change(3)], cursor: 3, hasMore: false }],
    ['the same seq twice', { changes: [change(3), { ...change(4), seq: 3 }], cursor: 3, hasMore: false }],
    ['a cursor behind the last change', { changes: [change(3), change(7)], cursor: 3, hasMore: false }],
    ['a cursor past the last change', { changes: [change(3)], cursor: 9, hasMore: false }],
    ['an empty page with more to come', { changes: [], cursor: 3, hasMore: true }],
  ])('rejects %s', (_, page) => {
    expect(changesResponseSchema.safeParse(page).success).toBe(false);
  });

  describe('pageFollowsQuery', () => {
    const query = changesQuerySchema.parse({ since: '5', limit: '2' });
    const page = (changes: ReturnType<typeof change>[], cursor: number) =>
      changesResponseSchema.parse({ changes, cursor, hasMore: changes.length === 2 });

    it.each([
      ['changes after the cursor asked', page([change(6), change(9)], 9), true],
      ['an empty page that gives the cursor back', page([], 5), true],
      ['a change at the cursor asked, read already', page([change(5)], 5), false],
      ['an empty page that moves the cursor back', page([], 0), false],
      ['an empty page that moves the cursor ahead', page([], 8), false],
      ['a page longer than asked', changesResponseSchema.parse({ changes: [change(6), change(7), change(8)], cursor: 8, hasMore: true }), false],
    ])('answers %s: %s', (_, answered, expected) => {
      expect(pageFollowsQuery(query, answered)).toBe(expected);
    });
  });
});

describe('newRevisions', () => {
  it('keeps every revision of a new batch, in the order sent', () => {
    const batch = [revision('op1', 'rev1'), revision('op2', 'rev2'), revision('op1', 'rev3', { total: 2000 })];
    expect(newRevisions(batch, received())).toStrictEqual(batch);
  });

  it('leaves out a replayed revision, so that it does not overwrite the newer one that arrived meanwhile', () => {
    expect(newRevisions([revision('op1', 'rev1'), revision('op2', 'rev2')], received('rev1', 'rev9'))).toStrictEqual([revision('op2', 'rev2')]);
  });

  it('keeps the first of two revisions sent twice in one batch', () => {
    expect(newRevisions([revision('op1', 'rev1'), revision('op1', 'rev1', { total: 5 })], received())).toStrictEqual([revision('op1', 'rev1')]);
  });

  it('keeps a deleted operation deleted when an older revision is replayed', () => {
    const before = [revision('op1', 'rev1'), revision('op1', 'rev2', { deleted: true })];
    const written = [...newRevisions(before, received()), ...newRevisions([revision('op1', 'rev1')], received('rev1', 'rev2'))];
    expect(currentState(written).get(revision('op1', 'rev1').id)).toStrictEqual(revision('op1', 'rev2', { deleted: true }));
  });

  // The outbox sends its revisions in order and resends any of them in later batches, the network having lost the answer; batches handled one after
  // the other (concurrent requests are the database's to serialise) must write each revision once, in the order it first arrived.
  const sends = fc
    .array(fc.record({ operation: fc.constantFrom('op1', 'op2', 'op3'), deleted: fc.boolean() }), { minLength: 1, maxLength: 20 })
    .map((changes) =>
      changes.map(({ operation, deleted }, index) => revision(operation, `rev${String(index)}`, deleted ? { deleted: true } : { total: index + 1 })),
    )
    .chain((revisions) =>
      fc.tuple(
        fc.constant(revisions),
        fc.array(fc.array(fc.nat({ max: revisions.length - 1 }), { maxLength: 5 }), { minLength: revisions.length, maxLength: revisions.length }),
        fc.nat({ max: MAX_BATCH_REVISIONS - 1 }),
      ),
    );

  it('writes each revision once, in the order it first arrived, whatever is replayed', () => {
    fc.assert(
      fc.property(sends, ([revisions, replays, batchSize]) => {
        // Revision i is sent, followed by replays of revisions already sent; the stream is cut into batches.
        const stream = revisions.flatMap((operation, index) => [
          operation,
          ...(replays[index] ?? []).filter((replayed) => replayed <= index).flatMap((replayed) => revisions[replayed] ?? []),
        ]);
        const known = new Set<RevisionId>();
        const written: Operation[] = [];
        for (let start = 0; start < stream.length; start += batchSize + 1) {
          for (const operation of newRevisions(stream.slice(start, start + batchSize + 1), known)) {
            known.add(operation.revisionId);
            written.push(operation);
          }
        }
        expect(written).toStrictEqual(revisions);
      }),
    );
  });
});
