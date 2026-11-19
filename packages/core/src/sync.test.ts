import { describe, expect, it } from 'vitest';

import { type Operation, operationSchema } from './operation.ts';
import {
  apiErrorSchema,
  changesQuerySchema,
  changesResponseSchema,
  MAX_BATCH_REVISIONS,
  MAX_CHANGES,
  operationBatchResponseSchema,
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

  it('reads the cursor, its revision and the page size from the query strings, ignoring other parameters', () => {
    expect(changesQuerySchema.parse({ since: '42', revision: 'rev1', limit: '10', cache: '1' })).toStrictEqual({
      since: 42,
      revision: 'rev1',
      limit: 10,
    });
  });

  it.each([
    ['a cursor past 0 without its revision', { since: '42' }],
    ['a revision without a cursor', { revision: 'rev1' }],
    ['a revision with the cursor 0', { since: '0', revision: 'rev1' }],
    ['a malformed revision', { since: '42', revision: 'rev 1' }],
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
    createdSeq: 1,
  });

  it('accepts a page of current revisions by increasing seq, the cursor on the last one', () => {
    const page = { changes: [change(3), { ...change(7, true), createdSeq: 7 }], cursor: 7, hasMore: true };
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
    ['a change without createdSeq', { changes: [{ ...change(3), createdSeq: undefined }], cursor: 3, hasMore: false }],
    ['an operation created after its change', { changes: [{ ...change(3), createdSeq: 4 }], cursor: 3, hasMore: false }],
    ['changes out of order', { changes: [change(7), change(3)], cursor: 3, hasMore: false }],
    ['the same seq twice', { changes: [change(3), { ...change(4), seq: 3 }], cursor: 3, hasMore: false }],
    ['a cursor behind the last change', { changes: [change(3), change(7)], cursor: 3, hasMore: false }],
    ['a cursor past the last change', { changes: [change(3)], cursor: 9, hasMore: false }],
    ['an empty page with more to come', { changes: [], cursor: 3, hasMore: true }],
  ])('rejects %s', (_, page) => {
    expect(changesResponseSchema.safeParse(page).success).toBe(false);
  });

  describe('pageFollowsQuery', () => {
    const query = changesQuerySchema.parse({ since: '5', revision: 'rev5', limit: '2' });
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

describe('operationBatchResponseSchema', () => {
  it('accepts one result per revision: written with its seq, duplicate, or rejected with a reason', () => {
    const response = {
      results: [
        { revisionId: 'rev1', status: 'written', seq: 12 },
        { revisionId: 'rev2', status: 'duplicate' },
        { revisionId: 'rev3', status: 'rejected', reason: 'unknown_member' },
      ],
    };
    expect(operationBatchResponseSchema.parse(response)).toStrictEqual(response);
  });

  it.each([
    ['no result', { results: [] }],
    ['a written revision without seq', { results: [{ revisionId: 'rev1', status: 'written' }] }],
    ['a rejection without reason', { results: [{ revisionId: 'rev1', status: 'rejected' }] }],
    ['an unknown reason', { results: [{ revisionId: 'rev1', status: 'rejected', reason: 'too_late' }] }],
    ['an unknown status', { results: [{ revisionId: 'rev1', status: 'pending' }] }],
  ])('rejects %s', (_, response) => {
    expect(operationBatchResponseSchema.safeParse(response).success).toBe(false);
  });
});

describe('apiErrorSchema', () => {
  it('accepts a known error and nothing else', () => {
    expect(apiErrorSchema.parse({ error: 'unknown_cursor' })).toStrictEqual({ error: 'unknown_cursor' });
    expect(apiErrorSchema.safeParse({ error: 'teapot' }).success).toBe(false);
  });
});
