/** JSON with object keys sorted, so that two equal revisions give the same text whatever the order their fields came in. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, nested: unknown) =>
    nested !== null && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.fromEntries(Object.entries(nested).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : nested,
  );
}
