import { useDebouncedValue } from "@yaakapp-internal/ui";
import { useCallback } from "react";
import { createGlobalState } from "react-use";

/** What's typed in the filter box. `null` means the filter box is closed */
const useFilterTextMap = createGlobalState<Record<string, string | null>>({});

export interface ResponseFilterApi {
  stateKey: string | null;
  /** What's typed in the filter box, or `null` when the box is closed */
  filterText: string | null;
  /** The expression to actually filter with, lagging `filterText` by a debounce */
  debouncedFilterText: string | null;
  isSearching: boolean;
  setFilterText: (value: string | null) => void;
  toggleSearch: () => void;
}

/**
 * Filter state for a response viewer, keyed so it persists across responses of the
 * same request.
 *
 * Owned by the component that runs the filter, so the viewer can stay presentational.
 * Evaluating the expression during the viewer's render (its previous shape) meant
 * updating the parent mid-render, which React warns about.
 */
export function useResponseFilter({ stateKey }: { stateKey: string | null }): ResponseFilterApi {
  const [filterTextMap, setFilterTextMap] = useFilterTextMap();
  const filterText = stateKey ? (filterTextMap[stateKey] ?? null) : null;
  const debouncedFilterText = useDebouncedValue(filterText);

  const setFilterText = useCallback(
    (v: string | null) => {
      if (!stateKey) return;
      setFilterTextMap((m) => ({ ...m, [stateKey]: v }));
    },
    [stateKey, setFilterTextMap],
  );

  const isSearching = filterText != null;
  const toggleSearch = useCallback(() => {
    setFilterText(isSearching ? null : "");
  }, [isSearching, setFilterText]);

  return {
    stateKey,
    filterText,
    debouncedFilterText,
    isSearching,
    setFilterText,
    toggleSearch,
  };
}
