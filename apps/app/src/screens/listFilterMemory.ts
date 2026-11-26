import { createContext, use, useCallback, useState } from 'react';

import { type ListFilter, NO_FILTER } from '../model/listFilter.ts';

/**
 * Filters of each group's list by its link's token, for as long as the app is open: kept when a group's screens unmount (another group opened,
 * then this one again), never written on the phone, so that a new opening of the app shows the whole list (docs/decisions/filtres-de-la-liste.md).
 */
export type ListFilterMemory = Map<string, ListFilter>;

// The app provides its own; this one only serves a screen rendered without it.
export const ListFilterMemoryContext = createContext<ListFilterMemory>(new Map());

/** The filters of a group's list and the function that changes them, kept in the app's memory. */
export function useListFilter(token: string): readonly [ListFilter, (filter: ListFilter) => void] {
  const memory = use(ListFilterMemoryContext);
  const [filter, setFilter] = useState(() => memory.get(token) ?? NO_FILTER);
  const change = useCallback(
    (next: ListFilter) => {
      memory.set(token, next);
      setFilter(next);
    },
    [memory, token],
  );
  return [filter, change];
}
