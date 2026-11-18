import { z } from 'zod';

/** Amount in whole cents: the only unit of computation in the project, never a floating-point number. */
export const centsSchema = z.int().nonnegative().brand('Cents');
export type Cents = z.infer<typeof centsSchema>;

// Accepted thousands separators: space, no-break space and narrow no-break space (the one Intl produces in French).
const SPACES = /[ \u00A0\u202F]/g;
// Integer part in groups of three (“1 234”) or as one block, then at most two decimals after a comma or a dot.
const ENTERED_AMOUNT = /^(\d{1,3}(?: \d{3})+|\d+)(?:[.,](\d{1,2}))?$/;
// Cap: 99 999 999,99 €, far above any use and below Number.MAX_SAFE_INTEGER once in cents.
const MAX_INTEGER_DIGITS = 8;
const INVALID_AMOUNT = 'invalid_amount';

/** Amount typed by a person (“12”, “12,5”, “1 234,56”) converted to cents; an invalid entry is rejected, never rounded. */
export const enteredAmountSchema = z
  .string({ error: INVALID_AMOUNT })
  .transform((entry, context) => {
    const parts = ENTERED_AMOUNT.exec(entry.trim().replace(SPACES, ' '));
    // Leading zeros do not count towards the cap: “000000001” is 1 €.
    const integer = parts?.[1]?.replace(SPACES, '').replace(/^0+(?=\d)/, '');
    if (integer === undefined || integer.length > MAX_INTEGER_DIGITS) {
      context.addIssue({ code: 'custom', message: INVALID_AMOUNT });
      return z.NEVER;
    }
    const decimals = (parts?.[2] ?? '').padEnd(2, '0');
    return Number.parseInt(integer, 10) * 100 + Number.parseInt(decimals, 10);
  })
  .pipe(centsSchema);
