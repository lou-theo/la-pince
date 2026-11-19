const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const signedEuros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });

/**
 * A whole number of cents in euros, French style (`1 234,50 €`). The decimal string is built from integers and handed to `Intl` as is, so that no
 * float ever rounds a cent; `signed` adds `+` to a positive amount, for balances.
 */
export function formatCents(cents: number, { signed = false }: { readonly signed?: boolean } = {}): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`not a whole number of cents: ${String(cents)}`);
  }
  const magnitude = Math.abs(cents);
  const decimal = `${cents < 0 ? '-' : ''}${String(Math.trunc(magnitude / 100))}.${String(magnitude % 100).padStart(2, '0')}`;
  return (signed ? signedEuros : euros).format(decimal as `${number}`);
}

/** Cents as a person types them (`1234,50`), to prefill a form field that `enteredAmountSchema` reads back to the same cents. */
export function centsToInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`not a whole, non-negative number of cents: ${String(cents)}`);
  }
  return `${String(Math.trunc(cents / 100))},${String(cents % 100).padStart(2, '0')}`;
}
