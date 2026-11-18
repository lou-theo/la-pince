import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { enteredAmountSchema } from './amount.ts';

describe('enteredAmountSchema', () => {
  it.each([
    ['0', 0],
    ['12', 1200],
    ['12,5', 1250],
    ['12,05', 1205],
    ['12.34', 1234],
    ['0,01', 1],
    ['  7,10 ', 710],
    ['1 234,56', 123456],
    ['1\u00A0234,56', 123456],
    ['1\u202F234\u202F567', 123456700],
    ['99999999,99', 9999999999],
    ['007', 700],
    ['000000001', 100],
    ['0 099 999 999,99', 9999999999],
  ])('converts “%s” to %i cents', (entry, cents) => {
    expect(enteredAmountSchema.parse(entry)).toBe(cents);
  });

  it.each([
    ['', 'empty'],
    ['abc', 'not a number'],
    ['-5', 'negative'],
    ['12,345', 'three decimals'],
    ['12,', 'comma without decimals'],
    [',5', 'no integer part'],
    ['12 34', 'incomplete thousands group'],
    ['1,2,3', 'two decimal separators'],
    ['1e3', 'scientific notation'],
    ['100000000', 'above the cap'],
    ['1.234', 'dot ambiguous between thousands and decimals'],
    ['1.234,56', 'thousands separated by a dot'],
    ['1234 567', 'first group longer than three digits'],
    ['１２', 'non-ASCII digits'],
  ])('rejects “%s” (%s)', (entry) => {
    const result = enteredAmountSchema.safeParse(entry);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('invalid_amount');
  });

  it.each([undefined, null, 12])('rejects an entry that is not text (%s)', (entry) => {
    const result = enteredAmountSchema.safeParse(entry);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('invalid_amount');
  });

  it('finds every amount in cents back, however it is written', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9_999_999_999 }),
        fc.boolean(),
        fc.constantFrom(',', '.'),
        fc.nat(),
        (cents, grouped, separator, pick) => {
          const euros = Math.floor(cents / 100);
          const remainder = cents % 100;
          const integer = grouped ? new Intl.NumberFormat('fr-FR').format(euros) : String(euros);
          // Exact ways to write the decimal part: “,05” always, “,5” for 50 cents, nothing for a round amount.
          const decimals = [`${separator}${String(remainder).padStart(2, '0')}`];
          if (remainder % 10 === 0) {
            decimals.push(`${separator}${String(remainder / 10)}`);
          }
          if (remainder === 0) {
            decimals.push('');
          }
          const entry = `${integer}${decimals[pick % decimals.length] ?? ''}`;
          expect(enteredAmountSchema.parse(entry)).toBe(cents);
        },
      ),
    );
  });
});
