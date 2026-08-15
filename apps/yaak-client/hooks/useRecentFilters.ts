import { useCallback } from "react";
import { useKeyValue } from "./useKeyValue";

export interface RecentFilter {
  value: string;
  pinned?: boolean;
}

const MAX_RECENT_FILTERS = 20;
const kvKey = (filterStateKey: string) => `recent_filters::${filterStateKey}`;
const namespace = "global";
const fallback: RecentFilter[] = [];

export function useRecentFilters(filterStateKey: string | null) {
  const { value, set } = useKeyValue<RecentFilter[]>({
    key: kvKey(filterStateKey ?? "n/a"),
    namespace,
    fallback,
  });

  const addFilter = useCallback(
    async (rawValue: string) => {
      const value = rawValue.trim();
      if (filterStateKey == null || value === "") return;
      await set((prev) => {
        // Returning the same reference skips the write, so re-committing the
        // expression already at the top (on every blur) costs nothing
        if (prev[0]?.value === value) return prev;
        const existing = prev.find((f) => f.value === value);
        const rest = prev.filter((f) => f.value !== value);
        return trim([{ value, pinned: existing?.pinned }, ...rest]);
      });
    },
    [filterStateKey, set],
  );

  const removeFilter = useCallback(
    async (value: string) => set((prev) => prev.filter((f) => f.value !== value)),
    [set],
  );

  const togglePin = useCallback(
    async (value: string) =>
      set((prev) => prev.map((f) => (f.value === value ? { ...f, pinned: !f.pinned } : f))),
    [set],
  );

  const clearFilters = useCallback(async () => set([]), [set]);

  return { recentFilters: value ?? fallback, addFilter, removeFilter, togglePin, clearFilters };
}

/** Bound the list, evicting the oldest unpinned entries before any pinned ones */
function trim(filters: RecentFilter[]): RecentFilter[] {
  const excess = filters.length - MAX_RECENT_FILTERS;
  if (excess <= 0) return filters;

  const evicted = new Set<number>();
  for (let i = filters.length - 1; i >= 0 && evicted.size < excess; i--) {
    if (!filters[i]?.pinned) evicted.add(i);
  }
  for (let i = filters.length - 1; i >= 0 && evicted.size < excess; i--) {
    evicted.add(i);
  }

  return filters.filter((_, i) => !evicted.has(i));
}
