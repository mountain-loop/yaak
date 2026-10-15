import { atom, useAtom } from "jotai";
import { atomFamily } from "jotai-family";
import { useCallback, useState } from "react";

/** What's typed in the filter box. `null` means the filter box is closed */
const filterTextAtoms = atomFamily((_stateKey: string) => atom<string | null>(null));

/** What's actually applied to the text. Only changes on an explicit apply */
const appliedFilterAtoms = atomFamily((_stateKey: string) => atom<string | null>(null));

export interface TextFilterApi {
  stateKey: string | null;
  /** Draft text in the filter box, or `null` when the box is closed */
  filterText: string | null;
  /** The expression currently filtering the text */
  appliedFilter: string | null;
  isSearching: boolean;
  /** The box holds an expression that isn't the one currently applied */
  isDirty: boolean;
  /** Bumped when the (uncontrolled) filter input must re-read its defaultValue */
  filterUpdateKey: number;
  setFilterText: (value: string | null) => void;
  /** Apply the expression to the text, reporting it to `onApplied` if the filter accepts it */
  applyFilter: (value: string) => void;
  /** Like applyFilter, but also replaces what's shown in the filter box */
  replaceFilter: (value: string) => void;
  toggleSearch: () => void;
}

/**
 * Draft/applied state for a text filter (JSONPath/XPath).
 *
 * `onApplied` hears at most once per apply gesture, and only after `runFilter`
 * confirms the filter accepts the expression — the filter is the sole judge of
 * validity. Because nothing but the gesture reports, refetches can't resurrect
 * deleted history entries and a gesture can't report into another state key.
 */
export function useTextFilter({
  stateKey,
  runFilter,
  onApplied,
}: {
  stateKey: string | null;
  /** Evaluate an expression, rejecting if the filter reports an error */
  runFilter: (filter: string) => Promise<unknown>;
  onApplied?: (filter: string) => void;
}): TextFilterApi {
  const [storedFilterText, setStoredFilterText] = useAtom(filterTextAtoms(stateKey ?? ""));
  const [storedAppliedFilter, setStoredAppliedFilter] = useAtom(appliedFilterAtoms(stateKey ?? ""));
  const filterText = stateKey ? storedFilterText : null;
  const appliedFilter = stateKey ? storedAppliedFilter : null;

  const setFilterText = useCallback(
    (v: string | null) => {
      if (!stateKey) return;
      setStoredFilterText(v);
    },
    [stateKey, setStoredFilterText],
  );

  const setAppliedFilter = useCallback(
    (v: string | null) => {
      if (!stateKey) return;
      setStoredAppliedFilter(v);
    },
    [stateKey, setStoredAppliedFilter],
  );

  const applyFilter = useCallback(
    (value: string) => {
      setFilterText(value);
      const applied = value.trim() === "" ? null : value.trim();
      setAppliedFilter(applied);
      if (applied == null) return;
      runFilter(applied).then(
        () => onApplied?.(applied),
        () => {}, // Rejected by the filter — don't report
      );
    },
    [setFilterText, setAppliedFilter, runFilter, onApplied],
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
  };
}
