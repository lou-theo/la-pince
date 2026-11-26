import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { NO_FILTER } from '../model/listFilter.ts';
import { type ListFilterMemory, ListFilterMemoryContext, useListFilter } from './listFilterMemory.ts';

describe('useListFilter', () => {
  it("keeps each group's filters in the app's memory, found again when the group's screens mount anew", () => {
    const memory: ListFilterMemory = new Map();
    const wrapper = ({ children }: { readonly children: ReactNode }) => <ListFilterMemoryContext value={memory}>{children}</ListFilterMemoryContext>;
    const first = renderHook(() => useListFilter('group-a'), { wrapper });
    expect(first.result.current[0]).toBe(NO_FILTER);
    act(() => {
      first.result.current[1]({ ...NO_FILTER, involvesMe: true });
    });
    expect(first.result.current[0].involvesMe).toBe(true);
    first.unmount();

    expect(renderHook(() => useListFilter('group-a'), { wrapper }).result.current[0].involvesMe).toBe(true);
    // Another group starts without filters.
    expect(renderHook(() => useListFilter('group-b'), { wrapper }).result.current[0]).toBe(NO_FILTER);
  });
});
