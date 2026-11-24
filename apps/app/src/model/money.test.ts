import { enteredAmountSchema, MAX_CENTS } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { centsToInput, formatCents } from './money.ts';

// `Intl` separates thousands with a narrow no-break space and puts a no-break space before the euro sign.
const nbsp = ' ';
const thin = ' ';

describe('formatCents', () => {
  it('writes cents in euros to the cent, at the bounds', () => {
    expect(formatCents(0)).toBe(`0,00${nbsp}€`);
    expect(formatCents(1)).toBe(`0,01${nbsp}€`);
    expect(formatCents(99)).toBe(`0,99${nbsp}€`);
    expect(formatCents(100)).toBe(`1,00${nbsp}€`);
    expect(formatCents(123_450)).toBe(`1${thin}234,50${nbsp}€`);
    expect(formatCents(MAX_CENTS)).toBe(`99${thin}999${thin}999,99${nbsp}€`);
  });

  it('writes a negative amount, and the largest balance a group could reach, without rounding', () => {
    expect(formatCents(-1)).toBe(`-0,01${nbsp}€`);
    expect(formatCents(-150)).toBe(`-1,50${nbsp}€`);
    expect(formatCents(Number.MAX_SAFE_INTEGER)).toBe(`90${thin}071${thin}992${thin}547${thin}409,91${nbsp}€`);
  });

  it('refuses what is not a whole number of cents', () => {
    expect(() => formatCents(0.5)).toThrow(RangeError);
    expect(() => formatCents(Number.NaN)).toThrow(RangeError);
    expect(() => formatCents(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe('centsToInput', () => {
  it('writes cents as typed back into a form, which reads them to the same cents', () => {
    expect([0, 5, 99, 100, 123_450, MAX_CENTS].map(centsToInput)).toStrictEqual(['0,00', '0,05', '0,99', '1,00', '1234,50', '99999999,99']);
    for (const cents of [0, 5, 99, 100, 123_450, MAX_CENTS]) {
      expect(enteredAmountSchema.parse(centsToInput(cents))).toBe(cents);
    }
  });

  it('refuses what is not whole, non-negative cents', () => {
    expect(() => centsToInput(-1)).toThrow(RangeError);
    expect(() => centsToInput(0.5)).toThrow(RangeError);
  });
});
