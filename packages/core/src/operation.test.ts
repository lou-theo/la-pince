import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { computeEffect } from './effect.ts';
import { type MemberId, memberIdSchema } from './ids.ts';
import { type Operation, operationEffect, operationSchema, unknownMembers } from './operation.ts';

const entry = {
  version: 1,
  kind: 'expense',
  payer: 'alice',
  total: 1000,
  lines: [
    { member: 'alice', weight: 1 },
    { member: 'bob', weight: 1 },
  ],
};
const expense = { id: 'op1', revisionId: 'rev1', title: 'Groceries', date: '2026-11-16', entry };
const deletion = { id: 'op1', revisionId: 'rev2', title: 'Groceries', date: '2026-11-16', deleted: true };
const group = (...members: string[]): Set<MemberId> => new Set(members.map((member) => memberIdSchema.parse(member)));

describe('operationSchema', () => {
  it('accepts an operation with its entry, with or without an author', () => {
    expect(operationSchema.parse(expense)).toStrictEqual(expense);
    expect(operationSchema.parse({ ...expense, author: 'bob' })).toStrictEqual({ ...expense, author: 'bob' });
  });

  it('accepts the mark of a deleted operation', () => {
    expect(operationSchema.parse(deletion)).toStrictEqual(deletion);
  });

  it.each([
    ['both an entry and the deletion mark', { ...expense, deleted: true }],
    ['neither an entry nor the deletion mark', { ...deletion, deleted: undefined }],
    ['a deletion mark set to false', { ...deletion, deleted: false }],
    ['an unknown field', { ...expense, effect: {} }],
    ['an entry that does not add up', { ...expense, entry: { ...entry, total: undefined } }],
    ['a day that does not exist', { ...expense, date: '2026-02-30' }],
    ['a date with a time', { ...expense, date: '2026-11-16T10:00:00Z' }],
    ['an empty title', { ...expense, title: '' }],
    ['a title over 100 characters', { ...expense, title: 'a'.repeat(101) }],
    ['an empty revision id', { ...expense, revisionId: '' }],
    ['an id over 64 characters', { ...expense, id: 'a'.repeat(65) }],
    ['an author that is not an id', { ...expense, author: 42 }],
  ])('rejects %s', (_, operation) => {
    expect(operationSchema.safeParse(operation).success).toBe(false);
  });

  it('accepts a title of 100 characters and ids of 64', () => {
    const longest = { ...expense, id: 'a'.repeat(64), revisionId: 'b'.repeat(64), title: 'c'.repeat(100) };
    expect(operationSchema.parse(longest)).toStrictEqual(longest);
  });
});

describe('operationEffect', () => {
  it('computes the effect of the entry, seeded by the operation id', () => {
    const operation = operationSchema.parse({ ...expense, entry: { ...entry, total: 1001 } });
    if (!('entry' in operation)) {
      throw new Error('expected an entry');
    }
    expect(operationEffect(operation)).toStrictEqual(computeEffect(operation.id, operation.entry));
    expect(
      operationEffect(operation)
        ?.shares.map((share) => share.amount)
        .toSorted(),
    ).toStrictEqual([500, 501]);
  });

  it('gives a deleted operation no effect', () => {
    expect(operationEffect(operationSchema.parse(deletion))).toBeUndefined();
  });

  const members = ['alice', 'bob', 'carol', 'dave', 'eve'];
  const operations = fc
    .record({
      id: fc.string({ minLength: 1, maxLength: 64 }),
      total: fc.integer({ min: 1, max: 100_000_000 }),
      involved: fc.uniqueArray(fc.constantFrom(...members), { minLength: 1 }),
      payer: fc.constantFrom(...members),
    })
    .map(({ id, total, involved, payer }) =>
      operationSchema.parse({
        id,
        revisionId: 'rev',
        title: 'Dinner',
        date: '2026-11-16',
        entry: { version: 1, kind: 'expense', payer, total, lines: involved.map((member) => ({ member, weight: 1 })) },
      }),
    );

  it('gives the same effect once the operation has travelled between phone and server', () => {
    fc.assert(
      fc.property(operations, (operation) => {
        const received = operationSchema.parse(JSON.parse(JSON.stringify(operation)));
        expect(operationEffect(received)).toStrictEqual(operationEffect(operation));
      }),
    );
  });
});

describe('unknownMembers', () => {
  const parse = (operation: Record<string, unknown>): Operation => operationSchema.parse(operation);

  it('finds none when the payer, the lines and the author are members of the group', () => {
    expect(unknownMembers(parse({ ...expense, author: 'bob' }), group('alice', 'bob'))).toStrictEqual([]);
  });

  it.each([
    ['a payer', { ...expense, entry: { ...entry, payer: 'mallory' } }],
    ['a line', { ...expense, entry: { ...entry, lines: [...entry.lines, { member: 'mallory', weight: 1 }] } }],
    ['an author', { ...expense, author: 'mallory' }],
    ['the author of a deletion', { ...deletion, author: 'mallory' }],
  ])('finds %s outside the group', (_, operation) => {
    expect(unknownMembers(parse(operation), group('alice', 'bob'))).toStrictEqual(['mallory']);
  });

  it('names each unknown member once, payer first, then the lines, then the author', () => {
    const operation = parse({
      ...expense,
      author: 'oscar',
      entry: {
        ...entry,
        payer: 'mallory',
        lines: [
          { member: 'peggy', amount: 600 },
          { member: 'mallory', amount: 400 },
        ],
      },
    });
    expect(unknownMembers(operation, group('alice', 'bob'))).toStrictEqual(['mallory', 'peggy', 'oscar']);
  });

  it('checks nothing else on a deletion without an author', () => {
    expect(unknownMembers(parse(deletion), group())).toStrictEqual([]);
  });

  it('finds exactly the named members missing from the group', () => {
    const everyone = ['alice', 'bob', 'carol', 'dave'];
    fc.assert(
      fc.property(
        fc.constantFrom(...everyone),
        fc.uniqueArray(fc.constantFrom(...everyone), { minLength: 1 }),
        fc.option(fc.constantFrom(...everyone), { nil: undefined }),
        fc.subarray(everyone),
        (payer, involved, author, inGroup) => {
          const operation = parse({
            ...expense,
            ...(author === undefined ? {} : { author }),
            entry: { ...entry, payer, lines: involved.map((member) => ({ member, weight: 1 })) },
          });
          const named = new Set([payer, ...involved, ...(author === undefined ? [] : [author])]);
          const unknown = unknownMembers(operation, group(...inGroup));
          expect(new Set(unknown)).toStrictEqual(new Set([...named].filter((member) => !inGroup.includes(member))));
          expect(unknown).toHaveLength(new Set(unknown).size);
        },
      ),
    );
  });
});
