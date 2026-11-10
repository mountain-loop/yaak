import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { Compartment } from "@codemirror/state";
import { EditorView, tooltips, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  Dropdown,
  Icon,
  IconButton,
  Input,
  type InputHandle,
  LazyCodeEditor,
} from "@yaakapp-internal/ui";
import { queryFilter } from "@yaakapp-internal/ui/editor";
import classNames from "classnames";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
  type CSSProperties,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { useExportShownHar } from "../lib/flowActions";
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
 * clears it. Focused, it wraps a long query over as many lines as it needs, as Yaak's URL bar
 * does, over what is below; blurred, it is one line again.
 */
export const SearchBar = memo(function SearchBar() {
  const [text, setText] = useAtom(searchTextAtom);
  const setTerms = useSetAtom(searchTermsAtom);
  const setSearchText = useSetAtom(setSearchTextAtom);
  const version = useAtomValue(searchTextVersionAtom);
  const total = useAtomValue(allTrafficTotalAtom);
  const store = useStore();
  const setSavedDialog = useSetAtom(savedSearchDialogAtom);
  const exportShown = useExportShownHar();
  // Nothing to search while captured traffic is locked.
  const locked = useAtomValue(lockedAtom) != null;
  const schema = useRpcQuery("query_schema", {}, { staleTime: Infinity }).data?.schema;
  const handleRef = useRef<InputHandle | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  // Where the box is while focused, so it grows over the list from the header's place for it
  const [place, setPlace] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!focused) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const rect = boxRef.current?.getBoundingClientRect();
      if (rect != null) setPlace({ top: rect.top, left: rect.left, width: rect.width });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [focused]);

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
  const extensions = useMemo(() => [compartment.current.of(filter), completionAcrossBox], [filter]);
  useEffect(() => {
    handleRef.current?.dispatch({ effects: compartment.current.reconfigure(filter) });
  }, [filter]);

  // The field is replaced to take a value from outside, so focus moves to the new one.
  const clear = () => {
    setSearchText("");
    requestAnimationFrame(() => handleRef.current?.focus());
  };

  return (
    // Holds the header's place for the box, which floats over the list while focused
    <div ref={boxRef} className="relative h-sm">
      <div
        style={place ?? undefined}
        className={classNames(place == null ? "absolute inset-x-0 top-0" : "fixed z-30")}
      >
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
          containerClassName={classNames(focused && "bg-surface shadow-lg")}
          stateKey={null}
          language={null}
          wrapLines={focused}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
              // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- keeps focus in the editor
              <div
                // Pressing these leaves the editor focused, so a wrapped box does not collapse and
                // move them before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                className="flex items-center self-center ml-1 mr-0.5"
              >
                <Dropdown
                  items={[
                    {
                      label: "Save search",
                      leftSlot: <Icon icon="bookmark" />,
                      onSelect: () => setSavedDialog({ mode: "save", query: text.trim() }),
                    },
                    exportShown(),
                  ]}
                >
                  <IconButton
                    size="xs"
                    icon="ellipsis"
                    title="Search actions"
                    tooltip
                    iconColor="secondary"
                  />
                </Dropdown>
                <IconButton
                  size="xs"
                  icon="x"
                  title="Clear search"
                  tooltip
                  iconColor="secondary"
                  onClick={clear}
                />
              </div>
            )
          }
        />
      </div>
    </div>
  );
});

/** The search box's width, which its completions take */
const BOX_WIDTH_VAR = "--proxy-search-width";

/** The search box an editor is in */
function boxOf(view: EditorView): HTMLElement | null {
  return view.dom.closest<HTMLElement>(".x-theme-input");
}

/** Pixels between a completion's info and the window's edge */
const INFO_MARGIN = 8;

/**
 * Where a completion's info goes: beside the list, in the window's room either side of the box,
 * or, with none, under the option as CodeMirror puts it in a narrow space
 */
function positionInfo(
  view: EditorView,
  list: { left: number; right: number; top: number; bottom: number },
  option: { top: number; bottom: number },
  info: { left: number; right: number; top: number; bottom: number },
): { style: string; class: string } {
  const win = view.dom.ownerDocument.defaultView ?? window;
  const width = info.right - info.left;
  const height = info.bottom - info.top;
  const right = win.innerWidth - list.right - INFO_MARGIN;
  const left = list.left - INFO_MARGIN;
  if (Math.max(left, right) >= width) {
    const top = Math.max(0, Math.min(option.top, win.innerHeight - height)) - list.top;
    const onRight = right >= width;
    return {
      style: `top: ${top}px; max-width: ${onRight ? right : left}px`,
      class: onRight ? "cm-completionInfo-right" : "cm-completionInfo-left",
    };
  }
  return {
    style: `top: ${option.bottom - list.top}px; max-width: 400px`,
    class: "cm-completionInfo-right-narrow",
  };
}

/**
 * The completions under the search box, as wide as it and level with its left edge, rather
 * than a narrow list wherever the cursor is
 */
const completionAcrossBox: Extension = [
  autocompletion({ positionInfo }),
  tooltips({
    tooltipSpace: (view) => {
      const win = view.dom.ownerDocument.defaultView ?? window;
      const rect = boxOf(view)?.getBoundingClientRect();
      return {
        top: 0,
        bottom: win.innerHeight,
        left: rect?.left ?? 0,
        right: rect?.right ?? win.innerWidth,
      };
    },
  }),
  ViewPlugin.fromClass(
    class {
      observer: ResizeObserver | null = null;

      constructor(view: EditorView) {
        this.watch(view);
      }

      // The editor is put in the page after it is made, so the box may only be found later.
      update(update: ViewUpdate) {
        if (this.observer == null) this.watch(update.view);
      }

      watch(view: EditorView) {
        const box = boxOf(view);
        if (box == null) return;
        const root = view.dom.ownerDocument.documentElement;
        this.observer = new ResizeObserver(() => {
          root.style.setProperty(BOX_WIDTH_VAR, `${box.getBoundingClientRect().width}px`);
        });
        this.observer.observe(box);
      }

      destroy() {
        this.observer?.disconnect();
      }
    },
  ),
  EditorView.theme({
    ".cm-tooltip.cm-tooltip-autocomplete": { width: `var(${BOX_WIDTH_VAR})` },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": { minWidth: "0", maxWidth: "none" },
  }),
];

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
