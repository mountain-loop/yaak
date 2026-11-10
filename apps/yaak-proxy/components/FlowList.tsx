import { useVirtualizer } from "@tanstack/react-virtual";
import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow, FlowSortKey } from "@yaakapp-internal/proxy-lib";
import {
  ContextMenu,
  CONTROL_TOOLTIP_DELAY,
  CountBadge,
  type DropdownItem,
  formatMillis,
  HttpMethodTagRaw,
  HttpStatusTagRaw,
  Icon,
  Tooltip,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  RefObject,
  WheelEvent,
} from "react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  appliedFilterAtom,
  placeSelectionAtom,
  revealFlowAtom,
  selectedFlowIdAtom,
} from "../lib/atoms";
import { shortContentType } from "../lib/body";
import { utcTimestamp } from "../lib/flowViews";
import {
  type Column,
  type ColumnId,
  cellFilterTerm,
  columnShifts,
  customValue,
  gridTemplate,
  gridWidth,
  hostOf,
  isCustomColumn,
  nextSort,
  operationOf,
  showOperationFor,
  shownColumns,
  tlsVersionOf,
  toggleSortKey,
  unavailableColumns,
  urlParts,
} from "../lib/columns";
import { useExportShownHar, useFlowActions } from "../lib/flowActions";
import { compareFlows } from "../lib/flowWindow";
import { countNewFlows, isAtEnd, resumesFollowing } from "../lib/follow";
import { applyFilter, goToPlace } from "../lib/navigation";
import { asOneTerm } from "../lib/query";
import { folderOf } from "../lib/search";
import {
  columnPrefsAtom,
  hasAppsAtom,
  flowSortAtom,
  followAtom,
  loadMoreSortedAtom,
  loadOlderFlowsAtom,
  newestStartedAtAtom,
  oldestFlowAtom,
  proxyStateAtom,
  searchLoadingAtom,
  flowsAtom,
  shownFlowsAtom,
} from "../lib/store";
import { useShowToast } from "../lib/toast";
import { AppIcon } from "./AppIcon";
import { FlowListEmpty, PausedRow } from "./FlowListEmpty";
import { type ColumnDragEvent, FlowListHeader } from "./FlowListHeader";

const BOTTOM_PADDING = 6;
/** Rows from the top at which older flows start loading, or from the bottom, sorted, more */
const LOAD_OLDER_ROWS = 20;
/** How long a row that arrives while following stays tinted */
const ARRIVAL_MS = 1400;
/** Most flows arriving together that still tint; more is a burst */
const ARRIVAL_MAX_BATCH = 5;

/** `h-xs`, the height of Yaak's event rows and menu items, in pixels at the root font size */
function rowHeight(): number {
  const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 15;
  return Math.round(1.8 * root);
}

interface Props {
  style?: CSSProperties;
  className?: string;
}

/**
 * Follows new traffic until a flow is selected or the list is scrolled, then holds. Scrolling to
 * the top loads older flows from the database. Catching up leaves a divider where the hold
 * began. Sorting by columns reads the flows from the database in that order, a page at a time on
 * scrolling down, and stops following. The columns keep their widths, and the list scrolls
 * sideways when they are wider than it, the header with it.
 */
export function FlowList({ style, className }: Props) {
  const flows = useAtomValue(shownFlowsAtom);
  const [menu, setMenu] = useState<{
    flow: Flow;
    column: ColumnId | null;
    x: number;
    y: number;
  } | null>(null);
  const flowActions = useFlowActions();
  const cellActions = useCellActions();
  const exportShown = useExportShownHar();
  const store = useStore();
  const selectedId = useAtomValue(selectedFlowIdAtom);
  const loadOlder = useSetAtom(loadOlderFlowsAtom);
  const loadMoreSorted = useSetAtom(loadMoreSortedAtom);
  const oldestFlow = useAtomValue(oldestFlowAtom);
  const [prefs, setPrefs] = useAtom(columnPrefsAtom);
  const [sort, setSort] = useAtom(flowSortAtom);
  const sorted = sort.length > 0;
  const allFlows = useAtomValue(flowsAtom);

  // Operation shows itself the first time a flow has one, unless the person set it already.
  useEffect(() => {
    if (prefs.visible.operation !== undefined) return;
    const next = showOperationFor(prefs, allFlows);
    if (next !== prefs) setPrefs(next);
  }, [prefs, allFlows, setPrefs]);
  const proxyState = useAtomValue(proxyStateAtom);
  const paused = proxyState?.state === "running" && proxyState.recording === false;
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  // The list's vertical scrollbar, which the header leaves room for so the two scroll as far
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  // The list's visible height, so a resize that leaves it at its end follows again
  const [viewportHeight, setViewportHeight] = useState(0);
  const ignoreScroll = useRef(false);
  const [following, setFollowing] = useAtom(followAtom);
  const [heldAt, setHeldAt] = useState<string | null>(null);
  /** The first flow after the last catch-up's hold, and how many came after it */
  const [divider, setDivider] = useState<{ id: string; count: number } | null>(null);
  // The newest flow across all traffic, not just this list, so a filter change keeps the hold
  const newestStartedAt = useAtomValue(newestStartedAtAtom);
  const ROW_HEIGHT = useMemo(rowHeight, []);
  // Read by the callbacks below, which stay the same across new traffic so rows don't re-render
  const latest = useRef({ flows, following, newestStartedAt, heldAt, sort });
  useLayoutEffect(() => {
    latest.current = { flows, following, newestStartedAt, heldAt, sort };
  });

  // Where the platform cannot tell which app sent a flow, there is no App column.
  const hasApps = useAtomValue(hasAppsAtom);
  const columns = useMemo(() => shownColumns(prefs, unavailableColumns(hasApps)), [prefs, hasApps]);
  const template = useMemo(() => gridTemplate(columns), [columns]);
  // A row's grid, its padding and the list's margins: `px-1.5` and `left-1.5 right-1.5`
  const contentWidth = useMemo(() => `calc(${gridWidth(columns)} + 1.5rem)`, [columns]);
  const arrivals = useArrivals(flows, following && !sorted);

  const virtualizer = useVirtualizer({
    count: flows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => flows[index]?.id ?? index,
    paddingEnd: BOTTOM_PADDING + (paused && flows.length > 0 ? ROW_HEIGHT + 8 : 0),
    overscan: 40,
  });

  const setScrollTop = useCallback((top: number) => {
    const el = scrollRef.current;
    if (el == null) return;
    const max = el.scrollHeight - el.clientHeight;
    const next = Math.max(0, Math.min(top, max));
    if (Math.abs(el.scrollTop - next) < 1) return;
    ignoreScroll.current = true;
    el.scrollTop = next;
  }, []);

  const hold = useCallback(() => {
    if (!latest.current.following) return;
    setFollowing(false);
    setHeldAt(latest.current.newestStartedAt);
  }, [setFollowing]);

  const follow = useCallback(() => {
    const { flows, heldAt, following, sort } = latest.current;
    // Catching up from a hold marks where it began.
    if (!following && sort.length === 0) {
      const count = countNewFlows(flows, heldAt);
      const first = flows[flows.length - count];
      setDivider(count > 0 && first != null ? { id: first.id, count } : null);
    }
    setSort([]);
    setFollowing(true);
    setHeldAt(null);
    setScrollTop(Number.MAX_SAFE_INTEGER);
  }, [setFollowing, setScrollTop, setSort]);

  // A sorted list never follows, whether the sort was just set, kept from the last launch, or
  // kept through a clear.
  useLayoutEffect(() => {
    if (sorted && following) setFollowing(false);
  }, [sorted, following, setFollowing]);

  // A held list follows again once it is at its end, not only when scrolled there: a sidebar row,
  // search or resize can leave it there with no scroll to make, as one that fits its viewport
  // always is, and its flows would otherwise count as new while all are on screen. Judged when
  // which flows are listed changes, or the list's height, not when one listed is updated or
  // `following` itself changes, so selecting a row at the end still holds; and not while a
  // search's first page loads, as its empty list is at its end only until the page is in.
  const searchLoading = useAtomValue(searchLoadingAtom);
  const listed = `${flows.length}:${flows[0]?.id ?? ""}:${flows.at(-1)?.id ?? ""}`;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el == null || searchLoading) return;
    if (!resumesFollowing({ following: latest.current.following, sorted, el })) return;
    setFollowing(true);
    setHeldAt(null);
  }, [listed, sorted, searchLoading, viewportHeight, setFollowing]);

  useLayoutEffect(() => {
    if (following && !sorted) setScrollTop(Number.MAX_SAFE_INTEGER);
  }, [following, sorted, flows, paused, setScrollTop]);

  // Sorted, rows that leave, deleted or moved past what is read, can leave the end of the list
  // in view with no scroll to load the next page; it loads as they go.
  useEffect(() => {
    const el = scrollRef.current;
    if (!sorted || el == null) return;
    const toEnd = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (toEnd < LOAD_OLDER_ROWS * ROW_HEIGHT) void loadMoreSorted();
  }, [sorted, flows, loadMoreSorted, ROW_HEIGHT]);

  // A new sort starts from its top.
  const sortKey = JSON.stringify(sort);
  useLayoutEffect(() => {
    if (sortKey !== "[]") setScrollTop(0);
  }, [sortKey, setScrollTop]);

  // Older flows that loaded in above push the rows down; scroll by as much, so they stay put.
  const anchor = useRef<Flow | null>(null);
  useLayoutEffect(() => {
    const previous = anchor.current;
    anchor.current = oldestFlow;
    if (following || sorted || previous == null || oldestFlow == null) return;
    if (compareFlows(oldestFlow, previous) >= 0) return;
    const added = flows.findIndex((f) => compareFlows(f, previous) >= 0);
    const el = scrollRef.current;
    if (added > 0 && el != null) setScrollTop(el.scrollTop + added * ROW_HEIGHT);
  }, [oldestFlow, flows, following, sorted, setScrollTop, ROW_HEIGHT]);

  // Sorted, the flows loaded are what is sorted; older ones would land anywhere.
  const loadOlderHeld = useCallback(() => {
    hold();
    if (latest.current.sort.length === 0) void loadOlder();
  }, [hold, loadOlder]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el == null) return;
    const measure = () => {
      setScrollbarWidth(el.offsetWidth - el.clientWidth);
      setViewportHeight(el.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el == null) return;
    if (headerScrollRef.current != null) headerScrollRef.current.scrollLeft = el.scrollLeft;
    // Sideways only: following and holding go by the vertical position.
    const top = el.scrollTop;
    const moved = top !== lastScrollTop.current;
    lastScrollTop.current = top;
    if (ignoreScroll.current) {
      ignoreScroll.current = false;
      return;
    }
    if (!moved) return;
    const sortedNow = latest.current.sort.length > 0;
    if (isAtEnd(el) && !sortedNow) {
      setFollowing(true);
      setHeldAt(null);
    } else {
      hold();
      if (el.scrollTop < LOAD_OLDER_ROWS * ROW_HEIGHT && !sortedNow) {
        void loadOlder();
      }
    }
    // Sorted, the next page of the sort loads near the bottom.
    const toEnd = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (sortedNow && toEnd < LOAD_OLDER_ROWS * ROW_HEIGHT) void loadMoreSorted();
  }, [hold, loadOlder, loadMoreSorted, setFollowing, ROW_HEIGHT]);

  // Focus moving to a sort button out of view scrolls the header itself; the rows follow.
  const handleHeaderScroll = useCallback(() => {
    const header = headerScrollRef.current;
    const el = scrollRef.current;
    if (header == null || el == null || header.scrollLeft === el.scrollLeft) return;
    el.scrollLeft = header.scrollLeft;
  }, []);

  // The header scrolls the list sideways, as it has no scrollbar of its own.
  const handleHeaderWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (el == null || e.deltaX === 0) return;
    el.scrollLeft += e.deltaX;
  }, []);

  // A dragged column: its ghost, and the others sliding aside to make room for it
  const rootRef = useRef<HTMLDivElement>(null);
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const onColumnDrag = useColumnDragView(rootRef, headerScrollRef, scrollRef);

  // A list too short to scroll still loads older flows on scrolling up.
  const handleWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      if (e.deltaY < 0 && e.currentTarget.scrollTop <= 0) loadOlderHeld();
    },
    [loadOlderHeld],
  );

  /** Scrolls a row into view, to its middle when `center` and it is out of view */
  const scrollToRow = useCallback(
    (index: number, center = false) => {
      const el = scrollRef.current;
      if (el == null) return;
      const top = index * ROW_HEIGHT;
      const above = top < el.scrollTop;
      const below = top + ROW_HEIGHT > el.scrollTop + el.clientHeight;
      if (center && (above || below)) setScrollTop(top - (el.clientHeight - ROW_HEIGHT) / 2);
      else if (above) setScrollTop(top);
      else if (below) setScrollTop(top + ROW_HEIGHT - el.clientHeight);
    },
    [setScrollTop, ROW_HEIGHT],
  );

  // A click is a place of its own to go back to; the arrow keys move the current place along.
  const select = useCallback(
    (index: number, move: "add" | "update") => {
      const flow = latest.current.flows[index];
      if (flow == null) return;
      goToPlace(store, move, { selection: [flow.id], flow });
      hold();
      scrollToRow(index);
    },
    [store, hold, scrollToRow],
  );
  const clickRow = useCallback((index: number) => select(index, "add"), [select]);

  // A place gone back to scrolls its flow into view once the list has it.
  const [reveal, setReveal] = useAtom(revealFlowAtom);
  const placeSelection = useAtomValue(placeSelectionAtom);
  useLayoutEffect(() => {
    if (reveal == null) return;
    // Selected elsewhere since
    if (!placeSelection.has(reveal.id)) {
      setReveal(null);
      return;
    }
    const index = flows.findIndex((f) => f.id === reveal.id);
    if (index === -1) return;
    setReveal(null);
    hold();
    scrollToRow(index, true);
  }, [reveal, placeSelection, flows, hold, scrollToRow, setReveal]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // ⌘↓ catches up, as the pill does.
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        follow();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const index = flows.findIndex((f) => f.id === selectedId);
      if (index === -1) select(e.key === "ArrowDown" ? 0 : flows.length - 1, "update");
      else if (index === 0 && e.key === "ArrowUp") loadOlderHeld();
      else {
        if (sorted && index >= flows.length - 2 && e.key === "ArrowDown") void loadMoreSorted();
        select(e.key === "ArrowDown" ? index + 1 : index - 1, "update");
      }
    },
    [flows, follow, loadOlderHeld, loadMoreSorted, select, selectedId, sorted],
  );

  const openMenu = useCallback(
    (index: number, e: MouseEvent) => {
      const flow = latest.current.flows[index];
      if (flow == null) return;
      e.preventDefault();
      select(index, "add");
      // The cell under the pointer, for the menu's items on its value
      const cellEl = (e.target as HTMLElement).closest<HTMLElement>("[data-column]");
      const column = (cellEl?.dataset.column as ColumnId | undefined) ?? null;
      setMenu({ flow, column, x: e.clientX, y: e.clientY });
    },
    [select],
  );

  // A click sorts by the column alone; a third goes back to arrival order, following as Reset
  // Sort does. Option-click adds the column to the sort, reverses it, then takes it out.
  const handleSort = useCallback(
    (column: ColumnId, add: boolean) => {
      const current = latest.current.sort;
      const next = add ? toggleSortKey(current, column) : nextSort(current, column);
      if (next.length === 0) {
        follow();
        return;
      }
      hold();
      setSort(next);
    },
    [follow, hold, setSort],
  );

  const handleSetSort = useCallback(
    (next: FlowSortKey[]) => {
      if (next.length === 0) {
        follow();
        return;
      }
      hold();
      setSort(next);
    },
    [follow, hold, setSort],
  );

  const menuItems = useMemo((): DropdownItem[] => {
    if (menu == null) return [];
    // The cell's value first, as it is what was right-clicked
    const cell = menu.column == null ? [] : cellActions(menu.flow, menu.column);
    return [
      ...(cell.length > 0 ? [...cell, { type: "separator" } as const] : []),
      ...flowActions(menu.flow),
      exportShown(),
    ];
  }, [menu, flowActions, cellActions, exportShown]);

  const newCount = following || sorted ? 0 : countNewFlows(flows, heldAt);
  const dividerIndex = divider == null ? -1 : flows.findIndex((f) => f.id === divider.id);
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={rootRef}
      style={style}
      className={classNames(
        className,
        "relative grid grid-rows-[auto_minmax(0,1fr)] grid-cols-[minmax(0,1fr)] min-h-0 text-sm",
      )}
    >
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- scrolls the list sideways */}
      <div
        ref={headerScrollRef}
        onWheel={handleHeaderWheel}
        onScroll={handleHeaderScroll}
        style={{ marginRight: scrollbarWidth }}
        className="overflow-hidden"
      >
        <FlowListHeader
          columns={columns}
          template={template}
          width={contentWidth}
          prefs={prefs}
          sort={sort}
          onSort={handleSort}
          onSetSort={handleSetSort}
          onResetSort={follow}
          scrollElement={getScrollElement}
          onColumnDrag={onColumnDrag}
        />
      </div>
      <div className="relative min-h-0">
        <div
          ref={scrollRef}
          data-flow-rows
          role="listbox"
          aria-label="Flows"
          tabIndex={0}
          onScroll={handleScroll}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          className="group/flows h-full overflow-auto outline-hidden"
        >
          {flows.length === 0 ? (
            <div className="h-full px-1.5">
              <FlowListEmpty />
            </div>
          ) : (
            <div
              className="relative"
              style={{ height: totalSize, width: contentWidth, minWidth: "100%" }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const flow = flows[item.index];
                if (flow == null) return null;
                return (
                  <FlowRow
                    key={flow.id}
                    flow={flow}
                    index={item.index}
                    start={item.start}
                    height={ROW_HEIGHT}
                    columns={columns}
                    template={template}
                    selected={flow.id === selectedId}
                    arrivedAt={arrivals.get(flow.id) ?? null}
                    onSelect={clickRow}
                    onContextMenu={openMenu}
                  />
                );
              })}
              {dividerIndex > 0 && divider != null && (
                <div
                  aria-hidden
                  style={{ top: dividerIndex * ROW_HEIGHT }}
                  className="pointer-events-none absolute left-1.5 right-1.5 h-0 border-t border-border"
                >
                  <span className="absolute -top-2 left-1 px-1 bg-surface text-2xs text-primary">
                    {divider.count === 1 ? "1 new" : `${divider.count} new`}
                  </span>
                </div>
              )}
              {paused && <PausedRow style={{ top: flows.length * ROW_HEIGHT }} />}
            </div>
          )}
        </div>
        {newCount > 0 && (
          <button
            type="button"
            onClick={follow}
            className={classNames(
              "absolute bottom-3 left-1/2 -translate-x-1/2",
              "flex items-center gap-1.5 h-6 px-3 rounded-full",
              "bg-surface border border-border shadow-lg text-text text-xs tabular-nums",
              "hover:bg-surface-highlight",
            )}
          >
            <Icon icon="arrow_down_to_line" size="sm" color="primary" />
            {newCount === 1 ? "1 new flow" : `${newCount} new flows`}
          </button>
        )}
        <ContextMenu triggerPosition={menu} items={menuItems} onClose={() => setMenu(null)} />
      </div>
    </div>
  );
}

/**
 * When each flow that arrived while following came in, for the tint that fades over
 * `ARRIVAL_MS`. Only the newest end of the list is checked, back to the first flow already
 * known, so a new flow costs the same however many are held.
 */
function useArrivals(flows: Flow[], following: boolean): Map<string, number> {
  const seen = useRef<{ known: Set<string> | null; arrivals: Map<string, number> }>({
    known: null,
    arrivals: new Map(),
  });
  // Worked out in the render the new flows cause, rather than in a second one after it.
  return useMemo(() => {
    const s = seen.current;
    if (s.known == null || !following) {
      s.known = new Set(flows.map((f) => f.id));
      return s.arrivals;
    }
    const now = Date.now();
    const arrived: string[] = [];
    for (let i = flows.length - 1; i >= 0; i--) {
      const flow = flows[i];
      if (flow == null || s.known.has(flow.id)) break;
      s.known.add(flow.id);
      arrived.push(flow.id);
    }
    // Kept to the flows held, which the window trims.
    if (s.known.size > flows.length * 2) s.known = new Set(flows.map((f) => f.id));
    // A burst renews every row in view, so tinting it says nothing and costs a layer a row.
    if (arrived.length === 0 || arrived.length > ARRIVAL_MAX_BATCH) return s.arrivals;
    const next = new Map<string, number>();
    for (const [id, at] of s.arrivals) if (now - at < ARRIVAL_MS) next.set(id, at);
    for (const id of arrived) next.set(id, now);
    s.arrivals = next;
    return next;
  }, [flows, following]);
}

/** How long the columns take to slide aside for a dragged column, or back */
const SLIDE_MS = 150;

/**
 * Shows a column's drag without rendering a row. Its ghost is its header and the cells of the
 * rows in view, copied once when the drag starts and following the pointer sideways. The column
 * hides where it is, and the columns between it and where it would drop slide aside by its width
 * to leave a gap there, all by one style element: a rule a column, header and cells together,
 * which rows arriving meanwhile follow too. Dropped, the rules go as the order changes, in the
 * same task, so nothing animates or jumps; put back, the columns slide home first.
 */
function useColumnDragView(
  rootRef: RefObject<HTMLDivElement | null>,
  headerRef: RefObject<HTMLDivElement | null>,
  listRef: RefObject<HTMLDivElement | null>,
): (event: ColumnDragEvent) => void {
  const drag = useRef<ColumnDragView | null>(null);
  // Columns sliding home after a drag was put back, until they are there
  const settling = useRef<{ style: HTMLStyleElement; timer: number } | null>(null);

  const settle = useCallback(() => {
    const s = settling.current;
    settling.current = null;
    if (s == null) return;
    clearTimeout(s.timer);
    s.style.remove();
  }, []);

  const onColumnDrag = useCallback(
    (event: ColumnDragEvent) => {
      const d = drag.current;
      switch (event.type) {
        case "move":
          d?.ghost?.move(event.x);
          return;
        case "target":
          if (d == null) return;
          d.to = event.to;
          d.style.textContent = columnDragCss(d);
          return;
        case "end": {
          drag.current = null;
          if (d == null) return;
          d.ghost?.remove();
          if (event.dropped || d.to == null) {
            d.style.remove();
            return;
          }
          d.to = null;
          d.style.textContent = columnDragCss(d);
          settling.current = { style: d.style, timer: window.setTimeout(settle, SLIDE_MS) };
          return;
        }
        case "start": {
          settle();
          d?.ghost?.remove();
          d?.style.remove();
          drag.current = null;
          const root = rootRef.current;
          const header = headerRef.current;
          const list = listRef.current;
          if (root == null || header == null || list == null) return;
          const cells = Array.from(
            header.querySelectorAll<HTMLElement>("[data-flow-header] > [data-column]"),
          );
          const ids = cells.map((c) => c.dataset.column as ColumnId);
          const from = ids.indexOf(event.id);
          if (from === -1) return;
          // Copied before it hides
          const ghost = snapshotColumn(event.id, event.x, root, header, list);
          const style = document.createElement("style");
          document.head.append(style);
          const widths = cells.map((c) => c.getBoundingClientRect().width);
          drag.current = { ghost, ids, widths, from, to: null, style };
          style.textContent = columnDragCss(drag.current);
        }
      }
    },
    [rootRef, headerRef, listRef, settle],
  );

  useEffect(
    () => () => {
      settle();
      drag.current?.ghost?.remove();
      drag.current?.style.remove();
      drag.current = null;
    },
    [settle],
  );
  return onColumnDrag;
}

interface ColumnDragView {
  ghost: ColumnGhost | null;
  /** The columns shown and their widths, the dragged one's place among them, and its target */
  ids: ColumnId[];
  widths: number[];
  from: number;
  to: number | null;
  style: HTMLStyleElement;
}

/** The rules for a drag: the column hidden, and those it passes slid aside */
function columnDragCss({ ids, widths, from, to }: ColumnDragView): string {
  // A row's cell is the box in its grid: the column's child, or inside the `contents` span a
  // tooltip wraps it in, as a box that is only its contents can't move
  const cells = (is: string) =>
    `[data-flow-rows] ${is} > :not(.contents), [data-flow-rows] ${is} > .contents > *`;
  const column = (id: ColumnId) => {
    const is = `[data-column="${CSS.escape(id)}"]`;
    return `[data-flow-header] > ${is}, ${cells(is)}`;
  };
  const rules = [
    `[data-flow-header] > [data-column], ${cells("[data-column]")} { transition: transform ${SLIDE_MS}ms ease; }`,
  ];
  const dragged = ids[from];
  if (dragged != null) rules.push(`${column(dragged)} { visibility: hidden; }`);
  const shifts = columnShifts(ids.length, from, widths[from] ?? 0, to);
  shifts.forEach((dx, i) => {
    const id = ids[i];
    if (dx !== 0 && id != null) rules.push(`${column(id)} { transform: translateX(${dx}px); }`);
  });
  // A failed flow's reason spans Type and Size together; while they part, it keeps to Type's
  // width, so it doesn't slide over the column past Size.
  const type = ids.indexOf("type");
  if (type !== -1 && ids[type + 1] === "size") {
    const size = type + 1;
    if (from === size || shifts[type] !== shifts[size]) {
      const is = '[data-flow-rows] [data-column="type"]';
      rules.push(
        `${is} > .col-span-2, ${is} > .contents > .col-span-2 { width: ${widths[type] ?? 0}px; }`,
      );
    }
  }
  return rules.join("\n");
}

interface ColumnGhost {
  /** Follows the pointer, across the window */
  move: (x: number) => void;
  remove: () => void;
}

function snapshotColumn(
  id: ColumnId,
  startX: number,
  root: HTMLElement,
  header: HTMLElement,
  list: HTMLElement,
): ColumnGhost | null {
  const cell = header.querySelector<HTMLElement>(`[data-column="${id}"]`);
  if (cell == null) return null;
  const rootBox = root.getBoundingClientRect();
  const cellBox = cell.getBoundingClientRect();
  const listBox = list.getBoundingClientRect();
  const listHeight = list.clientHeight;

  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.className = classNames(
    "pointer-events-none absolute top-0 z-20 overflow-hidden rounded-sm",
    // Lifted: a shadow, and just enough opacity to read as held, not enough to show text through
    "bg-surface border border-border-subtle shadow-lg opacity-95",
  );
  Object.assign(el.style, {
    left: `${cellBox.left - rootBox.left}px`,
    width: `${cellBox.width}px`,
    height: `${rootBox.height}px`,
    willChange: "transform",
  });

  // The header's label, without its resize handle
  const head = place(cellBox.top - rootBox.top, cellBox.height, "text-xs text-text-subtlest");
  const label = cell.cloneNode(true) as HTMLElement;
  for (const handle of label.querySelectorAll(".cursor-col-resize")) handle.remove();
  label.style.width = "100%";
  head.append(label);
  el.append(head);

  // The rows in view, clipped to the list as it shows them
  const rows = document.createElement("div");
  rows.className = "absolute left-0 right-0 overflow-hidden";
  Object.assign(rows.style, { top: `${listBox.top - rootBox.top}px`, height: `${listHeight}px` });
  for (const row of list.querySelectorAll<HTMLElement>('[role="option"]')) {
    const rowBox = row.getBoundingClientRect();
    if (rowBox.bottom <= listBox.top || rowBox.top >= listBox.top + listHeight) continue;
    const source = row.querySelector(`[data-column="${id}"]`);
    if (source == null) continue;
    const copy = place(
      rowBox.top - listBox.top,
      rowBox.height,
      classNames(
        "whitespace-nowrap tabular-nums",
        row.getAttribute("aria-selected") === "true" && "text-text bg-surface-highlight",
        row.classList.contains("text-text-subtlest") && "text-text-subtlest",
      ),
    );
    for (const child of source.children) {
      const clone = child.cloneNode(true) as HTMLElement;
      clone.style.width = "100%";
      copy.append(clone);
    }
    rows.append(copy);
  }
  el.append(rows);
  root.append(el);

  // Kept within the list's visible width
  const min = listBox.left;
  const max = Math.max(min, listBox.left + list.clientWidth - cellBox.width);
  const move = (x: number) => {
    const left = Math.min(max, Math.max(min, cellBox.left + x - startX));
    el.style.transform = `translateX(${left - cellBox.left}px)`;
  };
  move(startX);
  return { move, remove: () => el.remove() };
}

/** A line of the ghost, `top` pixels down its box */
function place(top: number, height: number, className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = classNames("absolute left-0 right-0 flex items-center", className);
  Object.assign(el.style, { top: `${top}px`, height: `${height}px` });
  return el;
}

interface RowProps {
  flow: Flow;
  index: number;
  start: number;
  height: number;
  columns: Column[];
  template: string;
  selected: boolean;
  /** When it arrived while following, for its tint, or null */
  arrivedAt: number | null;
  onSelect: (index: number) => void;
  onContextMenu: (index: number, e: MouseEvent) => void;
}

const FlowRow = memo(function FlowRow({
  flow,
  index,
  start,
  height,
  columns,
  template,
  selected,
  arrivedAt,
  onSelect,
  onContextMenu,
}: RowProps) {
  const failed = flow.error != null;
  // Failed or cancelled before any response; after the headers, the body was cut short mid-way.
  const noResponse = (failed || flow.cancelled) && flow.status == null;
  const ids = columns.map((c) => c.id);
  // A failure's reason, or Cancelled, takes the type and size cells together, side by side.
  const typeAt = ids.indexOf("type");
  const spanReason = noResponse && typeAt !== -1 && ids[typeAt + 1] === "size";
  const sinceArrival = arrivedAt == null ? null : Date.now() - arrivedAt;

  return (
    <div
      role="option"
      aria-selected={selected}
      onMouseDown={(e) => {
        if (e.button === 0) onSelect(index);
      }}
      onContextMenu={(e) => onContextMenu(index, e)}
      style={{
        height,
        transform: `translateY(${start}px)`,
        gridTemplateColumns: template,
        // Continues the fade where it was when a row scrolls back into view.
        ...(sinceArrival != null && sinceArrival < ARRIVAL_MS
          ? { animationDelay: `-${sinceArrival}ms` }
          : {}),
      }}
      className={classNames(
        "absolute top-0 left-1.5 right-1.5 grid items-center px-1.5 rounded-md whitespace-nowrap",
        "tabular-nums",
        flow.cancelled && "text-text-subtlest",
        selected
          ? "text-text bg-surface-highlight group-focus-within/flows:bg-surface-active"
          : "hover:bg-surface-highlight/50",
        sinceArrival != null && sinceArrival < ARRIVAL_MS && !selected && "flow-arrived",
      )}
    >
      <FlowMark flow={flow} />
      {columns.map((c) => {
        if (spanReason && c.id === "size") return null;
        return (
          // Names the cell's column for its menu, without a box of its own in the row's grid
          <div key={c.id} data-column={c.id} className="contents">
            <FlowCell column={c.id} flow={flow} span={spanReason && c.id === "type"} />
          </div>
        );
      })}
    </div>
  );
});

/**
 * One mark per row, by a fixed priority: failed, cancelled, not decrypted, streaming, cut, saved.
 * Its tooltip lists every state the flow has. Agent reads join it once the engine records them.
 */
function FlowMark({ flow }: { flow: Flow }) {
  const open = isOpenStream(flow);
  const states: string[] = [];
  if (flow.error != null) states.push(`Failed: ${flow.error}`);
  if (flow.cancelled) states.push("Cancelled by the app");
  if (flow.tunnelled) states.push("Not decrypted");
  if (open) states.push("Streaming");
  if (flow.responseTruncated) states.push("Body cut at the capture limit");
  if (flow.savedRequestId != null) states.push("Saved to Yaak");
  const mark = (
    <span className="flex items-center justify-center">
      {flow.error != null ? (
        <Icon icon="circle_alert" size="sm" color="danger" />
      ) : flow.cancelled ? (
        <Icon icon="circle_off" size="sm" className="text-text-subtlest" />
      ) : flow.tunnelled ? (
        <Icon icon="lock" size="sm" className="text-text-subtlest" />
      ) : open ? (
        <span aria-hidden className="w-[7px] h-[7px] rounded-full bg-info ring-3 ring-info/20" />
      ) : flow.responseTruncated ? (
        <Icon icon="scissors" size="sm" color="notice" />
      ) : flow.savedRequestId != null ? (
        <Icon icon="bookmark" size="sm" color="primary" className="[&_path]:fill-current" />
      ) : null}
    </span>
  );
  if (states.length === 0) return mark;
  return (
    <Tooltip wrap content={states.join("\n")} delay={CONTROL_TOOLTIP_DELAY}>
      {mark}
    </Tooltip>
  );
}

const mono = "font-mono text-xs";

/** Every cell: its padding matching the header's, and its text cut short at its width */
const cell = "min-w-0 px-1.5 overflow-hidden text-ellipsis";

/** A cell with its full text in a tooltip, shown when the cell cuts it short */
function Truncated({ text, children }: { text: string; children: ReactElement }) {
  return (
    <Tooltip wrap onlyWhenTruncated content={text} delay={CONTROL_TOOLTIP_DELAY}>
      {children}
    </Tooltip>
  );
}

/** An undecrypted tunnel still open: written as it opens, done once it closes */
function isOpenTunnel(flow: Flow): boolean {
  return flow.tunnelled && flow.elapsedMs == null && flow.error == null;
}

/** A WebSocket, event stream or gRPC call still open: written as it opens, done once it ends */
function isOpenStream(flow: Flow): boolean {
  return flow.streamKind != null && flow.elapsedMs == null && flow.error == null && !flow.cancelled;
}

function FlowCell({ column, flow, span }: { column: ColumnId; flow: Flow; span: boolean }) {
  const failed = flow.error != null;
  const noResponse = (failed || flow.cancelled) && flow.status == null;
  switch (column) {
    case "number":
      return (
        <span className={classNames(cell, mono, "text-text-subtlest")}>{flow.number || ""}</span>
      );
    case "app": {
      if (flow.clientPath == null) return <span className={cell} />;
      const name = flow.clientName ?? flow.clientPath;
      // A program outside an app says which folder it ran in, in full.
      const folder = folderOf(flow) == null ? null : flow.clientCwd;
      return (
        <Tooltip
          wrap
          content={folder == null ? name : `${name}\n${folder}`}
          delay={CONTROL_TOOLTIP_DELAY}
        >
          <span className={classNames(cell, "flex items-center")}>
            <AppIcon path={flow.clientPath} className="size-5" />
          </span>
        </Tooltip>
      );
    }
    case "method":
      return (
        <HttpMethodTagRaw
          method={flow.method}
          short
          className={classNames(cell, mono, !flow.cancelled && "text-text-subtle")}
        />
      );
    case "host": {
      const host = hostOf(flow.url);
      // Cut from the front, so the part that names the service stays.
      return (
        <Truncated text={host}>
          <span
            className={classNames(cell, "rtl text-left", !flow.cancelled && "text-text-subtle")}
          >
            <bdi>{host}</bdi>
          </span>
        </Truncated>
      );
    }
    case "path": {
      // A tunnel's only path is its host; what it carried is unread.
      if (flow.tunnelled) {
        return <span className={classNames(cell, "text-text-subtlest")}>Not decrypted</span>;
      }
      const path = pathOf(flow.url);
      if (flow.streamKind == null) {
        return (
          <Truncated text={path}>
            <span className={cell}>{path}</span>
          </Truncated>
        );
      }
      // A stream's message count rides the end of the path, so it survives the narrow width,
      // ticking while the stream is open.
      return (
        <Truncated text={path}>
          <span className={classNames(cell, "flex items-center")}>
            <span className="truncate">{path}</span>
            <CountBadge
              count={flow.messageCount}
              showZero
              color={isOpenStream(flow) ? "info" : undefined}
              className="shrink-0 !mb-0 tabular-nums"
            />
          </span>
        </Truncated>
      );
    }
    case "status":
      return (flow.cancelled || flow.tunnelled) && flow.status == null ? (
        <span className={classNames(cell, mono, "text-text-subtlest")}>--</span>
      ) : (
        <HttpStatusTagRaw status={flow.status ?? 0} short className={classNames(cell, mono)} />
      );
    case "type":
      return failed && noResponse ? (
        <Tooltip wrap content={flow.error ?? ""} delay={CONTROL_TOOLTIP_DELAY}>
          <span className={classNames(cell, "text-danger text-xs", span && "col-span-2")}>
            {flow.error}
          </span>
        </Tooltip>
      ) : flow.cancelled && noResponse ? (
        <span className={classNames(cell, "text-xs", span && "col-span-2")}>Cancelled</span>
      ) : (
        <span className={classNames(cell, mono, "text-text-subtlest")}>
          {shortContentType(flow.contentType) ?? "--"}
        </span>
      );
    case "size":
      return (
        <span
          className={classNames(
            cell,
            mono,
            "text-right",
            flow.responseTruncated ? "text-notice" : "text-text-subtle",
          )}
        >
          {noResponse ? "--" : formatSize(flow.responseSize)}
        </span>
      );
    case "time":
      // An open stream or tunnel shows how long it has been open, quietly, as its messages land.
      if (isOpenStream(flow) || isOpenTunnel(flow)) {
        const open = Date.now() - Date.parse(utcTimestamp(flow.startedAt));
        return (
          <span className={classNames(cell, mono, "text-right text-text-subtlest")}>
            {Number.isFinite(open) ? formatMillis(Math.max(0, open)) : "--"}
          </span>
        );
      }
      return (
        <span
          className={classNames(
            cell,
            mono,
            "text-right",
            // A second or more stands out without a new colour.
            flow.elapsedMs != null && flow.elapsedMs >= 1000 && !flow.cancelled
              ? "text-text"
              : "text-text-subtle",
          )}
        >
          {flow.elapsedMs == null ? "--" : formatMillis(flow.elapsedMs)}
        </span>
      );
    case "remote":
      return (
        <span className={classNames(cell, mono, "text-text-subtle")}>
          {flow.remoteAddr ?? "--"}
        </span>
      );
    case "version":
      return (
        <span className={classNames(cell, mono, "text-text-subtle")}>
          {flow.upstreamHttpVersion ?? flow.clientHttpVersion}
        </span>
      );
    case "query": {
      const query = flow.tunnelled ? "" : (urlParts(flow.url).query ?? "");
      return (
        <Truncated text={query}>
          <span className={classNames(cell, "text-text-subtle")}>{query}</span>
        </Truncated>
      );
    }
    case "started": {
      const at = new Date(utcTimestamp(flow.startedAt));
      if (Number.isNaN(at.getTime())) return <span className={cell} />;
      return (
        <Tooltip wrap content={at.toLocaleString()} delay={CONTROL_TOOLTIP_DELAY}>
          <span className={classNames(cell, mono, "text-text-subtle")}>{clockTime(at)}</span>
        </Tooltip>
      );
    }
    case "requestSize":
      return (
        <span
          className={classNames(
            cell,
            mono,
            "text-right",
            flow.requestTruncated ? "text-notice" : "text-text-subtle",
          )}
        >
          {flow.requestSize === 0 ? "--" : formatSize(flow.requestSize)}
        </span>
      );
    case "latency":
      return (
        <span className={classNames(cell, mono, "text-right text-text-subtle")}>
          {flow.elapsedHeadersMs == null ? "--" : formatMillis(flow.elapsedHeadersMs)}
        </span>
      );
    case "tls":
      return (
        <span className={classNames(cell, mono, "text-text-subtle")}>{tlsVersionOf(flow)}</span>
      );
    case "operation": {
      const operation = operationOf(flow) ?? "";
      return (
        <Truncated text={operation}>
          <span className={classNames(cell, "text-text-subtle")}>{operation}</span>
        </Truncated>
      );
    }
    default: {
      if (!isCustomColumn(column)) return <span className={cell} />;
      const value = customValue(flow, column.slice("field:".length)) ?? "";
      return (
        <Truncated text={value}>
          <span className={classNames(cell, mono, "text-text-subtle")}>{value}</span>
        </Truncated>
      );
    }
  }
}

/** The URL's path as the browser reads it, `/` for none, without the query */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** `14:03:27.481`, in local time */
function clockTime(at: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const ms = String(at.getMilliseconds()).padStart(3, "0");
  return `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}.${ms}`;
}

/**
 * The items a cell's menu adds for its value: a search term for it, either way, where its column
 * has a field to match it by, applied at once, and copying it
 */
function useCellActions(): (flow: Flow, column: ColumnId) => DropdownItem[] {
  const store = useStore();
  const showToast = useShowToast();
  return useCallback(
    (flow: Flow, column: ColumnId) => {
      const add = (term: string) => {
        // A search with `OR` at its top is grouped first, so the term narrows all of it.
        const text = store.get(appliedFilterAtom).trim();
        applyFilter(store, text === "" ? term : `${asOneTerm(text)} ${term}`);
      };
      const include = cellFilterTerm(flow, column, false);
      const exclude = cellFilterTerm(flow, column, true);
      const value = cellText(flow, column);
      const items: DropdownItem[] = [];
      if (include != null && exclude != null) {
        items.push(
          { label: "Filter by This Value", icon: "filter", onSelect: () => add(include) },
          { label: "Exclude This Value", icon: "minus_circle", onSelect: () => add(exclude) },
        );
      }
      if (value !== "") {
        items.push({
          label: "Copy Value",
          icon: "copy",
          onSelect: async () => {
            try {
              await navigator.clipboard.writeText(value);
              showToast({ message: "Copied value" });
            } catch (err) {
              showToast({ message: `Failed to copy value: ${String(err)}`, color: "danger" });
            }
          },
        });
      }
      return items;
    },
    [store, showToast],
  );
}

/** A cell's value as text, as it shows it, for copying */
function cellText(flow: Flow, column: ColumnId): string {
  if (isCustomColumn(column)) return customValue(flow, column.slice("field:".length)) ?? "";
  switch (column) {
    case "number":
      return flow.number ? String(flow.number) : "";
    case "app":
      return flow.clientName ?? flow.clientPath ?? "";
    case "method":
      return flow.method;
    case "host":
      return hostOf(flow.url);
    case "path":
      return flow.tunnelled ? "" : pathOf(flow.url);
    case "query":
      return flow.tunnelled ? "" : (urlParts(flow.url).query ?? "");
    case "status":
      return flow.status == null ? "" : String(flow.status);
    case "type":
      return flow.contentType ?? "";
    case "size":
      return String(flow.responseSize);
    case "requestSize":
      return String(flow.requestSize);
    case "time":
      return flow.elapsedMs == null ? "" : String(flow.elapsedMs);
    case "latency":
      return flow.elapsedHeadersMs == null ? "" : String(flow.elapsedHeadersMs);
    case "started": {
      const at = new Date(utcTimestamp(flow.startedAt));
      return Number.isNaN(at.getTime()) ? "" : at.toISOString();
    }
    case "remote":
      return flow.remoteAddr ?? "";
    case "version":
      return flow.upstreamHttpVersion ?? flow.clientHttpVersion;
    case "tls":
      return tlsVersionOf(flow);
    case "operation":
      return operationOf(flow) ?? "";
  }
}
