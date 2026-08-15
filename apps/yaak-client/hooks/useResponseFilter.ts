import { useCallback, useState } from "react";
import { createGlobalState } from "react-use";
import type { RecentFilter } from "./useRecentFilters";
import { useRecentFilters } from "./useRecentFilters";

/** What's typed in the filter box. `null` means the filter box is closed */
const useFilterTextMap = createGlobalState<Record<string, string | null>>({});

/** What's actually applied to the response. Only changes on an explicit apply */
const useAppliedFilterMap = createGlobalState<Record<string, string | null>>({});

export interface ResponseFilterApi {
  stateKey: string | null;
  /** Draft text in the filter box, or `null` when the box is closed */
  filterText: string | null;
  /** The expression currently filtering the response */
  appliedFilter: string | null;
  isSearching: boolean;
  /** The box holds an expression that isn't the one currently applied */
  isDirty: boolean;
  /** Bumped when the (uncontrolled) filter input must re-read its defaultValue */
  filterUpdateKey: number;
  setFilterText: (value: string | null) => void;
  /** Apply the expression to the response, recording it if the filter accepts it */
  applyFilter: (value: string) => void;
  /** Like applyFilter, but also replaces what's shown in the filter box */
  replaceFilter: (value: string) => void;
  toggleSearch: () => void;
  recentFilters: RecentFilter[];
  removeRecentFilter: (value: string) => void;
  togglePinRecentFilter: (value: string) => void;
  clearRecentFilters: () => void;
}

/**
 * Draft/applied state and history for a response filter (JSONPath/XPath).
 *
 * History records at most one entry per apply gesture, and only after `runFilter`
 * confirms the plugin accepts the expression — the plugin is the sole judge of
 * validity. Because nothing but the gesture ever writes, refetches can't resurrect
 * deleted entries and a gesture can't record into another request's history.
 */
export function useResponseFilter({
  stateKey,
  runFilter,
}: {
  stateKey: string | null;
  /** Evaluate an expression, rejecting if the filter plugin reports an error */
  runFilter: (filter: string) => Promise<unknown>;
}): ResponseFilterApi {
  const [filterTextMap, setFilterTextMap] = useFilterTextMap();
  const [appliedFilterMap, setAppliedFilterMap] = useAppliedFilterMap();
  const filterText = stateKey ? (filterTextMap[stateKey] ?? null) : null;
  const appliedFilter = stateKey ? (appliedFilterMap[stateKey] ?? null) : null;

  const setFilterText = useCallback(
    (v: string | null) => {
      if (!stateKey) return;
      setFilterTextMap((m) => ({ ...m, [stateKey]: v }));
    },
    [stateKey, setFilterTextMap],
  );

  const setAppliedFilter = useCallback(
    (v: string | null) => {
      if (!stateKey) return;
      setAppliedFilterMap((m) => ({ ...m, [stateKey]: v }));
    },
    [stateKey, setAppliedFilterMap],
  );

  const {
    recentFilters,
    addFilter,
    removeFilter: removeRecentFilter,
    togglePin: togglePinRecentFilter,
    clearFilters: clearRecentFilters,
  } = useRecentFilters(stateKey);

  const applyFilter = useCallback(
    (value: string) => {
      setFilterText(value);
      const applied = value.trim() === "" ? null : value.trim();
      setAppliedFilter(applied);
      if (applied == null) return;
      runFilter(applied).then(
        () => addFilter(applied),
        () => {}, // Rejected by the filter plugin — don't record
      );
    },
    [setFilterText, setAppliedFilter, runFilter, addFilter],
  );

  const [filterUpdateKey, setFilterUpdateKey] = useState(0);
  const replaceFilter = useCallback(
    (value: string) => {
      applyFilter(value);
      setFilterUpdateKey((k) => k + 1);
    },
    [applyFilter],
  );

  const isSearching = filterText != null;
  const toggleSearch = useCallback(() => {
    if (isSearching) {
      setFilterText(null);
      setAppliedFilter(null);
    } else {
      setFilterText("");
    }
  }, [isSearching, setFilterText, setAppliedFilter]);

  return {
    stateKey,
    filterText,
    appliedFilter,
    isSearching,
    isDirty: filterText != null && filterText.trim() !== (appliedFilter ?? ""),
    filterUpdateKey,
    setFilterText,
    applyFilter,
    replaceFilter,
    toggleSearch,
    recentFilters,
    removeRecentFilter,
    togglePinRecentFilter,
    clearRecentFilters,
  };
}
