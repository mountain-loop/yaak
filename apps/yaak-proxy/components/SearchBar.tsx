import { Icon, IconButton, PlainInput } from "@yaakapp-internal/ui";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { memo, type RefObject, useEffect, useRef } from "react";
import {
  allTrafficTotalAtom,
  searchTermsAtom,
  searchTextAtom,
  searchTextVersionAtom,
  searchWindowAtom,
  setSearchTextAtom,
  shownTotalAtom,
} from "../lib/store";

/** How long typing settles before the search runs */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * The header's search over every flow in the database, by URL, method, status and content type,
 * and the `@app`, `@host` and `@path` terms the sidebar writes. Its placeholder counts the flows;
 * a search's matches show inside it. ⌘F focuses it and Escape clears it.
 */
export const SearchBar = memo(function SearchBar() {
  const [text, setText] = useAtom(searchTextAtom);
  const setTerms = useSetAtom(searchTermsAtom);
  const setSearchText = useSetAtom(setSearchTextAtom);
  const version = useAtomValue(searchTextVersionAtom);
  // Read, not subscribed: `PlaceholderCount` keeps it current without re-rendering the field.
  const total = useStore().get(allTrafficTotalAtom);
  // PlainInput hands back its <input> as the ref
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTerms(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, setTerms]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The field is replaced to take a value from outside, so focus moves to the new one.
  const clear = () => {
    setSearchText("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <PlainInput
      ref={inputRef}
      label="Search flows"
      hideLabel
      size="sm"
      className="font-mono text-xs"
      placeholder={placeholderFor(total)}
      defaultValue={text}
      forceUpdateKey={String(version)}
      onChange={setText}
      onKeyDownCapture={(e) => {
        if (e.key === "Escape" && text !== "") {
          e.stopPropagation();
          clear();
        }
      }}
      leftSlot={
        <>
          <Icon icon="search" size="sm" className="ml-2 mr-1 self-center text-text-subtlest" />
          <PlaceholderCount inputRef={inputRef} />
        </>
      }
      rightSlot={
        text === "" ? (
          <kbd className="self-center mr-2 px-1 rounded-sm border border-border-subtle font-sans text-2xs text-text-subtlest">
            ⌘F
          </kbd>
        ) : (
          <div className="flex items-center gap-1 self-center">
            <MatchCount />
            <IconButton
              size="xs"
              icon="x"
              title="Clear search"
              iconColor="secondary"
              onClick={clear}
            />
          </div>
        )
      }
    />
  );
});

/**
 * Keeps the placeholder's count current as flows arrive, alone, so new traffic re-renders this
 * and not the whole field
 */
function PlaceholderCount({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const total = useAtomValue(allTrafficTotalAtom);
  useEffect(() => {
    if (inputRef.current != null) inputRef.current.placeholder = placeholderFor(total);
  }, [inputRef, total]);
  return null;
}

/** "Search 4,102 flows", the title and count that sat in the header's middle */
function placeholderFor(total: number): string {
  if (total === 0) return "Search flows";
  return `Search ${total.toLocaleString()} ${total === 1 ? "flow" : "flows"}`;
}

/** A search's matches of all traffic, "12 of 4,102", inside the field before its x */
function MatchCount() {
  const matches = useAtomValue(shownTotalAtom);
  const total = useAtomValue(allTrafficTotalAtom);
  const search = useAtomValue(searchWindowAtom);
  if (search == null || search.loading) return null;
  return (
    <span className="font-mono text-2xs text-text-subtlest tabular-nums whitespace-nowrap">
      {matches.toLocaleString()} of {total.toLocaleString()}
    </span>
  );
}
