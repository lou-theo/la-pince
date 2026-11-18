import { z } from 'zod';

import { centsSchema, MAX_CENTS } from './amount.ts';
import { memberIdSchema } from './ids.ts';

// Keeps `amount × weight` (at most MAX_CENTS × MAX_WEIGHT, about 1e13) an exact integer while sharing out what the fixed amounts leave.
const MAX_WEIGHT = 1_000;
// Far above a group's size; keeps the sum of fixed amounts and of weights exact.
const MAX_LINES = 100;

const fixedLineSchema = z.strictObject({ member: memberIdSchema, amount: centsSchema.refine((amount) => amount > 0, 'zero_amount') });
const weightedLineSchema = z.strictObject({ member: memberIdSchema, weight: z.int().positive().max(MAX_WEIGHT) });

/** Line of one member of the split: a fixed amount, or a weight in the sharing of what the fixed amounts leave of the total. */
export const entryLineSchema = z.union([fixedLineSchema, weightedLineSchema]);
export type EntryLine = z.infer<typeof entryLineSchema>;

export const kindSchema = z.enum(['expense', 'reimbursement']);
export type Kind = z.infer<typeof kindSchema>;

/**
 * What a person entered for an operation, version 1: one payer and one line per member of the split. Equal split: same weight on every line;
 * exact amounts: fixed amounts only, the total being their sum; both can be mixed. Only an entry parsed by this schema can be computed.
 */
export const entrySchema = z
  .strictObject({
    version: z.literal(1),
    kind: kindSchema,
    payer: memberIdSchema,
    total: centsSchema.optional(),
    lines: z.array(entryLineSchema).min(1).max(MAX_LINES),
  })
  .superRefine((entry, context) => {
    const members = new Set(entry.lines.map((line) => line.member));
    if (members.size !== entry.lines.length) {
      context.addIssue({ code: 'custom', message: 'duplicate_member', path: ['lines'] });
    }
    const fixed = entry.lines.reduce((sum, line) => sum + ('amount' in line ? line.amount : 0), 0);
    const weighted = entry.lines.some((line) => 'weight' in line);
    if (entry.total === undefined) {
      if (weighted) {
        context.addIssue({ code: 'custom', message: 'total_required', path: ['total'] });
      } else if (fixed > MAX_CENTS) {
        context.addIssue({ code: 'custom', message: 'total_too_large', path: ['lines'] });
      }
    } else if (weighted ? entry.total <= fixed : entry.total !== fixed) {
      // With weights, something must be left for them to share; without, the total is only a check of the amounts (decision 9).
      context.addIssue({ code: 'custom', message: weighted ? 'nothing_left_for_weights' : 'total_mismatch', path: ['total'] });
    }
  })
  .brand('Entry');
export type Entry = z.infer<typeof entrySchema>;
