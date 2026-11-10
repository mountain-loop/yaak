import {
  autocompletion,
  closeCompletion,
  type Completion,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { Compartment, Prec } from "@codemirror/state";
import { EditorView, keymap, tooltips, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  Dropdown,
  type DropdownItem,
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
import { useRpcQueryWithEvent } from "../hooks/useRpcQueryWithEvent";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { appliedFilterAtom } from "../lib/atoms";
import { isUnapplied, pressEnter, pressEscape, type Recall, stepHistory } from "../lib/filterBox";
import { useExportShownHar } from "../lib/flowActions";
import { applyFilter, searchDraftAtom, searchDraftVersionAtom } from "../lib/navigation";
import { rpc } from "../lib/rpc";
import { loadSeenValues, savedCompletions, searchProblems } from "../lib/searchBox";
import { allTrafficTotalAtom, lockedAtom, savedQueriesAtom, type Store } from "../lib/store";
import { useShowToast } from "../lib/toast";
import { savedSearchDialogAtom } from "./SavedSearchDialog";

/** Recent filters listed above the fields when the empty box is focused */
const RECENT_IN_COMPLETIONS = 5;

const NO_HISTORY: string[] = [];

/**
 * The header's search over every flow in the database, in the query language: bare words match
 * the URL, method, status and content type, and `@field:value` terms the rest, highlighted and
 * completed as Yaak's sidebar filter is, with the values the proxy has seen. The box composes a
 * filter and Enter applies it, as Yaak's URL bar sends; until then a return key at its right
 * says so, and Escape puts the applied filter back. The magnifier lists the filters applied
 * before, which Up in the empty box steps through too. Its placeholder counts the flows. ⌘F
 * focuses it. Focused, it wraps a long query over as many lines as it needs, as Yaak's URL bar
 * does, over what is below; blurred, it is one line again.
 */
export const SearchBar = memo(function SearchBar() {
  const [draft, setDraft] = useAtom(searchDraftAtom);
  const version = useAtomValue(searchDraftVersionAtom);
  const applied = useAtomValue(appliedFilterAtom);
  const total = useAtomValue(allTrafficTotalAtom);
  const store = useStore();
  const setSavedDialog = useSetAtom(savedSearchDialogAtom);
  const exportShown = useExportShownHar();
  // Nothing to search while captured traffic is locked.
  const locked = useAtomValue(lockedAtom) != null;
  const schema = useRpcQuery("query_schema", {}, { staleTime: Infinity }).data?.schema;
  const historyQuery = useRpcQueryWithEvent("list_filter_history", {}, "filter_history_changed", {
    enabled: !locked,
  });
  const history = useMemo(
    () => historyQuery.data?.map((e) => e.filter) ?? NO_HISTORY,
    [historyQuery.data],
  );
  const handleRef = useRef<InputHandle | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  // Where the box is while focused, so it grows over the list from the header's place for it
  const [place, setPlace] = useState<CSSProperties | null>(null);

  // Read by the editor's keys, which are made once
  const latest = useRef({ applied, history });
  useLayoutEffect(() => {
    latest.current = { applied, history };
  });

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
            leadCompletions: () => recentCompletions(latest.current.history),
            problems: searchProblems,
          }),
    [schema, store],
  );
  const keys = useMemo(() => boxKeys(store, latest), [store]);
  const extensions = useMemo(
    () => [compartment.current.of(filter), completionAcrossBox, keys],
    [filter, keys],
  );
  useEffect(() => {
    handleRef.current?.dispatch({ effects: compartment.current.reconfigure(filter) });
  }, [filter]);

  // Applies no filter at once, leaving the box focused and empty.
  const clear = () => {
    const handle = handleRef.current;
    handle?.dispatch({ changes: { from: 0, to: handle.value().length, insert: "" } });
    applyFilter(store, "");
    requestAnimationFrame(() => handleRef.current?.focus());
  };

  const unapplied = isUnapplied({ draft, applied });
  const hasText = draft !== "" || applied !== "";

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
          defaultValue={draft}
          forceUpdateKey={String(version)}
          onChange={setDraft}
          extensions={extensions}
          leftSlot={
            // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- keeps focus in the editor
            <div
              onMouseDown={(e) => e.preventDefault()}
              className="flex items-center self-center ml-0.5"
            >
              <FilterHistory history={history} store={store} disabled={locked} />
            </div>
          }
          rightSlot={
            // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- keeps focus in the editor
            <div
              // Pressing these leaves the editor focused, so a wrapped box does not collapse and
              // move them before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              className="flex items-center self-center ml-1 mr-0.5"
            >
              {unapplied ? (
                <Key className="mr-1">↵</Key>
              ) : hasText ? null : (
                <Key className="ml-1 mr-1.5">⌘F</Key>
              )}
              {hasText && (
                <>
                  <Dropdown
                    items={[
                      {
                        label: "Save search",
                        leftSlot: <Icon icon="bookmark" />,
                        onSelect: () =>
                          setSavedDialog({
                            mode: "save",
                            query: (draft.trim() === "" ? applied : draft).trim(),
                          }),
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
                </>
              )}
            </div>
          }
        />
      </div>
    </div>
  );
});

function Key({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={classNames(
        className,
        "px-1 rounded-sm border border-border-subtle font-sans text-2xs text-text-subtlest",
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * The magnifier, which lists the filters applied before, newest first: choosing one applies it
 * again, and each can be saved as a search or forgotten
 */
function FilterHistory({
  history,
  store,
  disabled,
}: {
  history: string[];
  store: Store;
  disabled: boolean;
}) {
  const setSavedDialog = useSetAtom(savedSearchDialogAtom);
  const showToast = useShowToast();
  const fail = (err: unknown) =>
    showToast({ id: "filter-history", message: String(err), color: "danger" });

  const items: DropdownItem[] =
    history.length === 0
      ? [{ label: "No recent filters", disabled: true }]
      : [
          ...history.map((filter): DropdownItem => ({
            label: (
              <span className="block font-mono text-xs truncate max-w-md" title={filter}>
                {filter}
              </span>
            ),
            onSelect: () => applyFilter(store, filter, { record: true }),
            actions: [
              {
                icon: "bookmark",
                title: "Save search",
                closeMenu: true,
                onSelect: () => setSavedDialog({ mode: "save", query: filter }),
              },
              {
                icon: "x",
                title: "Remove",
                onSelect: () => void rpc("delete_filter_history", { filter }).catch(fail),
              },
            ],
          })),
          { type: "separator" },
          {
            label: "Clear History",
            leftSlot: <Icon icon="trash" />,
            onSelect: () => void rpc("clear_filter_history", {}).catch(fail),
          },
        ];

  return (
    <Dropdown items={items}>
      <IconButton
        size="xs"
        icon="search"
        title="Recent filters"
        tooltip
        iconColor="secondary"
        disabled={disabled}
      />
    </Dropdown>
  );
}

/** The recent filters the empty box's completions start with */
function recentCompletions(history: string[]): Completion[] {
  return history.slice(0, RECENT_IN_COMPLETIONS).map((filter) => ({
    label: filter,
    detail: "Recent",
    type: "text",
    apply: filter,
  }));
}

/** The menu of completions is open, so the keys are its own */
function menuOpen(view: EditorView): boolean {
  return completionStatus(view.state) === "active";
}

function replaceText(view: EditorView, text: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: text.length },
  });
}

/**
 * Enter, Escape, Up and Down in the box, over the editor's own and under its completions': Enter
 * applies the draft, Escape puts the applied filter back or clears it, and Up and Down step
 * through the filter history from an empty box. Each is the completion menu's while it is open,
 * except Up from an empty box, which the history has.
 */
function boxKeys(
  store: Store,
  latest: { current: { applied: string; history: string[] } },
): Extension {
  let recall: Recall | null = null;
  const step = (view: EditorView, key: "up" | "down") => {
    const next = stepHistory(latest.current.history, recall, view.state.doc.toString(), key);
    if (next == null) return false;
    recall = next.recall;
    closeCompletion(view);
    replaceText(view, next.draft);
    return true;
  };
  const box = (view: EditorView) => ({
    draft: view.state.doc.toString(),
    applied: latest.current.applied,
  });
  return [
    Prec.high(
      keymap.of([
        {
          key: "Enter",
          stopPropagation: true,
          run: (view) => {
            if (menuOpen(view)) return false;
            const next = pressEnter(box(view));
            recall = null;
            applyFilter(store, next.apply ?? "", { record: next.record });
            return true;
          },
        },
        {
          key: "Escape",
          stopPropagation: true,
          run: (view) => {
            if (menuOpen(view)) return false;
            const next = pressEscape(box(view));
            if (next == null) return false;
            recall = null;
            replaceText(view, next.draft);
            if (next.apply != null) applyFilter(store, next.apply);
            return true;
          },
        },
        {
          key: "ArrowUp",
          run: (view) => {
            const draft = view.state.doc.toString();
            const stepping = recall != null && recall.text === draft;
            if (menuOpen(view) && draft !== "" && !stepping) return false;
            return step(view, "up");
          },
        },
        {
          key: "ArrowDown",
          run: (view) => (menuOpen(view) ? false : step(view, "down")),
        },
      ]),
    ),
    // The empty box lists the recent filters as it is focused.
    EditorView.domEventHandlers({
      focus: (_e, view) => {
        if (view.state.doc.length > 0 || latest.current.history.length === 0) return;
        requestAnimationFrame(() => {
          if (view.hasFocus && view.state.doc.length === 0) startCompletion(view);
        });
      },
    }),
  ];
}

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
