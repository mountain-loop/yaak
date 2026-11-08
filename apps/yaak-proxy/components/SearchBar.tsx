import { startCompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { Compartment } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  Dropdown,
  Icon,
  IconButton,
  Input,
  type InputHandle,
  LazyCodeEditor,
} from "@yaakapp-internal/ui";
import { queryFilter } from "@yaakapp-internal/ui/editor";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { memo, useEffect, useMemo, useRef } from "react";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { loadSeenValues, savedCompletions, searchProblems } from "../lib/searchBox";
import {
  allTrafficTotalAtom,
  lockedAtom,
  savedQueriesAtom,
  searchTermsAtom,
  searchTextAtom,
  searchTextVersionAtom,
  setSearchTextAtom,
} from "../lib/store";
import { savedSearchDialogAtom } from "./SavedSearchDialog";

/** How long typing settles before the search runs */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * The header's search over every flow in the database, in the query language: bare words match
 * the URL, method, status and content type, and `@field:value` terms the rest, highlighted and
 * completed as Yaak's sidebar filter is, with the values the proxy has seen. The backend runs
 * it and marks what it cannot. Its placeholder counts the flows. ⌘F focuses it and Escape
 * clears it.
 */
export const SearchBar = memo(function SearchBar() {
  const [text, setText] = useAtom(searchTextAtom);
  const setTerms = useSetAtom(searchTermsAtom);
  const setSearchText = useSetAtom(setSearchTextAtom);
  const version = useAtomValue(searchTextVersionAtom);
  const total = useAtomValue(allTrafficTotalAtom);
  const store = useStore();
  const setSavedDialog = useSetAtom(savedSearchDialogAtom);
  // Nothing to search while captured traffic is locked.
  const locked = useAtomValue(lockedAtom) != null;
  const schema = useRpcQuery("query_schema", {}, { staleTime: Infinity }).data?.schema;
  const handleRef = useRef<InputHandle | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTerms(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, setTerms]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        handleRef.current?.selectAll();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The language goes in once the schema is read: into the editor there is, through a
  // compartment, and into each one made after, as taking text from the sidebar makes one.
  const compartment = useRef(new Compartment());
  const filter = useMemo<Extension>(
    () =>
      schema == null
        ? []
        : queryFilter({
            schema,
            loadValues: loadSeenValues,
            // Read as completion opens, so saved searches are current without remaking it.
            moreCompletions: (typed) => savedCompletions(store.get(savedQueriesAtom), typed),
            problems: searchProblems,
          }),
    [schema, store],
  );
  const extensions = useMemo(() => compartment.current.of(filter), [filter]);
  useEffect(() => {
    handleRef.current?.dispatch({ effects: compartment.current.reconfigure(filter) });
  }, [filter]);

  // The field is replaced to take a value from outside, so focus moves to the new one.
  const clear = () => {
    setSearchText("");
    requestAnimationFrame(() => handleRef.current?.focus());
  };

  return (
    <Input
      renderEditor={(props) => (
        <LazyCodeEditor {...props} keyDownHandler={startCompletionOnCtrlSpace} />
      )}
      setRef={(h) => {
        handleRef.current = h;
      }}
      label="Search flows"
      hideLabel
      size="sm"
      className="font-mono text-xs"
      stateKey={null}
      language={null}
      wrapLines={false}
      placeholder={locked ? "Traffic is locked" : placeholderFor(total)}
      disabled={locked}
      defaultValue={text}
      forceUpdateKey={String(version)}
      onChange={setText}
      extensions={extensions}
      onKeyDown={(e) => {
        if (e.key === "Escape" && handleRef.current?.value() !== "") {
          e.stopPropagation();
          clear();
        }
      }}
      leftSlot={
        <Icon icon="search" size="sm" className="ml-2 mr-1 self-center text-text-subtlest" />
      }
      rightSlot={
        text === "" ? (
          <kbd className="self-center ml-2 mr-2 px-1 rounded-sm border border-border-subtle font-sans text-2xs text-text-subtlest">
            ⌘F
          </kbd>
        ) : (
          <div className="flex items-center self-center ml-1 mr-0.5">
            <Dropdown
              items={[
                {
                  label: "Save search",
                  leftSlot: <Icon icon="bookmark" />,
                  onSelect: () => setSavedDialog({ mode: "save", query: text.trim() }),
                },
              ]}
            >
              <IconButton size="xs" icon="ellipsis" title="Search actions" iconColor="secondary" />
            </Dropdown>
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
 * Ctrl+Space lists what can be typed, fields and saved searches on an empty spot, as it does in
 * Yaak's editors, whose shared editor leaves the key to each app
 */
function startCompletionOnCtrlSpace(e: KeyboardEvent, view: EditorView): boolean {
  if (!(e.ctrlKey && e.key === " " && !e.metaKey && !e.altKey && !e.shiftKey)) return false;
  e.preventDefault();
  startCompletion(view);
  return true;
}

/** "Search 4,102 flows", the title and count that sat in the header's middle */
function placeholderFor(total: number): string {
  if (total === 0) return "Search flows";
  return `Search ${total.toLocaleString()} ${total === 1 ? "flow" : "flows"}`;
}
