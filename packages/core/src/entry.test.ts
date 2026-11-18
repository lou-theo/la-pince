import { describe, expect, it } from 'vitest';

import { MAX_CENTS } from './amount.ts';
import { entrySchema } from './entry.ts';

const base = { version: 1, kind: 'expense', payer: 'alice' };

describe('entrySchema', () => {
  it.each([
    [
      'an equal split',
      {
        lines: [
          { member: 'alice', weight: 1 },
          { member: 'bob', weight: 1 },
        ],
        total: 3000,
      },
    ],
    [
      'exact amounts without a total',
      {
        lines: [
          { member: 'alice', amount: 1000 },
          { member: 'bob', amount: 500 },
        ],
      },
    ],
    [
      'exact amounts matching their total',
      {
        lines: [
          { member: 'alice', amount: 1000 },
          { member: 'bob', amount: 500 },
        ],
        total: 1500,
      },
    ],
    [
      'fixed amounts mixed with weights',
      {
        lines: [
          { member: 'alice', amount: 1000 },
          { member: 'bob', weight: 2 },
        ],
        total: 1500,
      },
    ],
    ['a payer who is not involved', { lines: [{ member: 'bob', amount: 1500 }] }],
  ])('accepts %s', (_, fields) => {
    expect(entrySchema.safeParse({ ...base, ...fields }).success).toBe(true);
  });

  it('accepts a reimbursement', () => {
    expect(entrySchema.safeParse({ ...base, kind: 'reimbursement', lines: [{ member: 'bob', amount: 1500 }] }).success).toBe(true);
  });

  it.each([
    [
      'duplicate_member',
      {
        lines: [
          { member: 'bob', amount: 100 },
          { member: 'bob', weight: 1 },
        ],
        total: 200,
      },
    ],
    ['total_required', { lines: [{ member: 'bob', weight: 1 }] }],
    [
      'total_too_large',
      {
        lines: [
          { member: 'alice', amount: MAX_CENTS },
          { member: 'bob', amount: 1 },
        ],
      },
    ],
    [
      'nothing_left_for_weights',
      {
        lines: [
          { member: 'alice', amount: 1000 },
          { member: 'bob', weight: 1 },
        ],
        total: 1000,
      },
    ],
    [
      'nothing_left_for_weights',
      {
        lines: [
          { member: 'alice', amount: 1000 },
          { member: 'bob', weight: 1 },
        ],
        total: 900,
      },
    ],
    ['total_mismatch', { lines: [{ member: 'alice', amount: 1000 }], total: 999 }],
    ['zero_amount', { lines: [{ member: 'alice', amount: 0 }] }],
  ])('rejects with %s', (message, fields) => {
    const result = entrySchema.safeParse({ ...base, ...fields });
    expect(result.error?.issues.map((issue) => issue.message)).toContain(message);
  });

  it.each([
    ['no line', { lines: [] }],
    ['more than 100 lines', { lines: Array.from({ length: 101 }, (_, index) => ({ member: `m${String(index)}`, amount: 1 })) }],
    ['a zero weight', { lines: [{ member: 'bob', weight: 0 }], total: 100 }],
    ['a weight above 1000', { lines: [{ member: 'bob', weight: 1001 }], total: 100 }],
    ['a fractional weight', { lines: [{ member: 'bob', weight: 1.5 }], total: 100 }],
    ['a line with both an amount and a weight', { lines: [{ member: 'bob', amount: 100, weight: 1 }] }],
    ['an amount in euros', { lines: [{ member: 'bob', amount: 12.5 }] }],
    ['an empty member id', { lines: [{ member: '', amount: 100 }] }],
    ['an unknown field', { lines: [{ member: 'bob', amount: 100 }], title: 'Pizza' }],
    ['another version', { version: 2, lines: [{ member: 'bob', amount: 100 }] }],
    ['an unknown kind', { kind: 'income', lines: [{ member: 'bob', amount: 100 }] }],
  ])('rejects %s', (_, fields) => {
    expect(entrySchema.safeParse({ ...base, ...fields }).success).toBe(false);
  });
});
