import { useVirtualizer } from "@tanstack/react-virtual";
import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow } from "@yaakapp-internal/proxy-lib";
import {
  ContextMenu,
  CountBadge,
  formatMillis,
  HttpMethodTagRaw,
  HttpStatusTagRaw,
  Icon,
  useContainerSize,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import type { CSSProperties, KeyboardEvent, MouseEvent, WheelEvent } from "react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { selectedFlowAtom, selectedFlowIdAtom } from "../lib/atoms";
import { shortContentType } from "../lib/body";
import { utcTimestamp } from "../lib/flowViews";
import {
  type Column,
  type ColumnId,
  gridTemplate,
  hostOf,
  nextSort,
  shownColumns,
} from "../lib/columns";
import { useExportShownHar, useFlowActions } from "../lib/flowActions";
import { compareFlows } from "../lib/flowWindow";
import { countNewFlows } from "../lib/follow";
import { folderOf } from "../lib/search";
import {
  columnPrefsAtom,
  hasAppsAtom,
  flowSortAtom,
  followAtom,
  loadOlderFlowsAtom,
  newestStartedAtAtom,
  oldestFlowAtom,
  proxyStateAtom,
  shownFlowsAtom,
} from "../lib/store";
import { AppIcon } from "./AppIcon";
import { FlowListEmpty, PausedRow } from "./FlowListEmpty";
import { FlowListHeader } from "./FlowListHeader";

const BOTTOM_PADDING = 6;
/** Rows from the top at which older flows start loading */
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
 * began. Sorting by a column sorts the flows loaded and stops following.
 */
export function FlowList({ style, className }: Props) {
  const flows = useAtomValue(shownFlowsAtom);
  const [menu, setMenu] = useState<{ flow: Flow; x: number; y: number } | null>(null);
  const flowActions = useFlowActions();
  const exportShown = useExportShownHar();
  const selectedId = useAtomValue(selectedFlowIdAtom);
  const setSelectedFlow = useSetAtom(selectedFlowAtom);
  const loadOlder = useSetAtom(loadOlderFlowsAtom);
  const oldestFlow = useAtomValue(oldestFlowAtom);
  const prefs = useAtomValue(columnPrefsAtom);
  const [sort, setSort] = useAtom(flowSortAtom);
  const proxyState = useAtomValue(proxyStateAtom);
  const paused = proxyState?.state === "running" && proxyState.recording === false;
  const containerRef = useRef<HTMLDivElement>(null);
  const { width } = useContainerSize(containerRef);
  const scrollRef = useRef<HTMLDivElement>(null);
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
  const columns = useMemo(
    () => shownColumns(prefs, width).filter((c) => hasApps || c.id !== "app"),
    [prefs, width, hasApps],
  );
  const template = useMemo(() => gridTemplate(columns), [columns]);
  const arrivals = useArrivals(flows, following && sort == null);

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
    if (!following && sort == null) {
      const count = countNewFlows(flows, heldAt);
      const first = flows[flows.length - count];
      setDivider(count > 0 && first != null ? { id: first.id, count } : null);
    }
    setSort(null);
    setFollowing(true);
    setHeldAt(null);
    setScrollTop(Number.MAX_SAFE_INTEGER);
  }, [setFollowing, setScrollTop, setSort]);

  useLayoutEffect(() => {
    if (following) setScrollTop(Number.MAX_SAFE_INTEGER);
  }, [following, flows, paused, setScrollTop]);

  // A new sort starts from its top.
  useLayoutEffect(() => {
    if (sort != null) setScrollTop(0);
  }, [sort, setScrollTop]);

  // Older flows that loaded in above push the rows down; scroll by as much, so they stay put.
  const anchor = useRef<Flow | null>(null);
  useLayoutEffect(() => {
    const previous = anchor.current;
    anchor.current = oldestFlow;
    if (following || sort != null || previous == null || oldestFlow == null) return;
    if (compareFlows(oldestFlow, previous) >= 0) return;
    const added = flows.findIndex((f) => compareFlows(f, previous) >= 0);
    const el = scrollRef.current;
    if (added > 0 && el != null) setScrollTop(el.scrollTop + added * ROW_HEIGHT);
  }, [oldestFlow, flows, following, sort, setScrollTop, ROW_HEIGHT]);

  // Sorted, the flows loaded are what is sorted; older ones would land anywhere.
  const loadOlderHeld = useCallback(() => {
    hold();
    if (latest.current.sort == null) void loadOlder();
  }, [hold, loadOlder]);

  const handleScroll = useCallback(() => {
    if (ignoreScroll.current) {
      ignoreScroll.current = false;
      return;
    }
    const el = scrollRef.current;
    if (el == null) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 2;
    if (atEnd && latest.current.sort == null) {
      setFollowing(true);
      setHeldAt(null);
    } else {
      hold();
      if (el.scrollTop < LOAD_OLDER_ROWS * ROW_HEIGHT && latest.current.sort == null) {
        void loadOlder();
      }
    }
  }, [hold, loadOlder, setFollowing, ROW_HEIGHT]);

  // A list too short to scroll still loads older flows on scrolling up.
  const handleWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      if (e.deltaY < 0 && e.currentTarget.scrollTop <= 0) loadOlderHeld();
    },
    [loadOlderHeld],
  );

  const select = useCallback(
    (index: number) => {
      const flow = latest.current.flows[index];
      if (flow == null) return;
      setSelectedFlow(flow);
      hold();
      const el = scrollRef.current;
      if (el == null) return;
      const top = index * ROW_HEIGHT;
      if (top < el.scrollTop) setScrollTop(top);
      else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
        setScrollTop(top + ROW_HEIGHT - el.clientHeight);
      }
    },
    [hold, setSelectedFlow, setScrollTop, ROW_HEIGHT],
  );

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
      if (index === -1) select(e.key === "ArrowDown" ? 0 : flows.length - 1);
      else if (index === 0 && e.key === "ArrowUp") loadOlderHeld();
      else select(e.key === "ArrowDown" ? index + 1 : index - 1);
    },
    [flows, follow, loadOlderHeld, select, selectedId],
  );

  const openMenu = useCallback(
    (index: number, e: MouseEvent) => {
      const flow = latest.current.flows[index];
      if (flow == null) return;
      e.preventDefault();
      select(index);
      setMenu({ flow, x: e.clientX, y: e.clientY });
    },
    [select],
  );

  const handleSort = useCallback(
    (column: ColumnId) => {
      hold();
      setSort((prev) => nextSort(prev, column));
    },
    [hold, setSort],
  );

  const newCount = following || sort != null ? 0 : countNewFlows(flows, heldAt);
  const dividerIndex = divider == null ? -1 : flows.findIndex((f) => f.id === divider.id);
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={containerRef}
      style={style}
      className={classNames(className, "grid grid-rows-[auto_minmax(0,1fr)] min-h-0 text-sm")}
    >
      <FlowListHeader
        columns={columns}
        template={template}
        prefs={prefs}
        sort={sort}
        onSort={handleSort}
        onSortByStart={follow}
      />
      <div className="relative min-h-0">
        <div
          ref={scrollRef}
          role="listbox"
          aria-label="Flows"
          tabIndex={0}
          onScroll={handleScroll}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          className="group/flows h-full overflow-y-auto px-1.5 outline-hidden"
        >
          {flows.length === 0 ? (
            <FlowListEmpty />
          ) : (
            <div className="relative" style={{ height: totalSize }}>
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
                    onSelect={select}
                    onContextMenu={openMenu}
                  />
                );
              })}
              {dividerIndex > 0 && divider != null && (
                <div
                  aria-hidden
                  style={{ top: dividerIndex * ROW_HEIGHT }}
                  className="pointer-events-none absolute inset-x-0 h-0 border-t border-border"
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
        <ContextMenu
          triggerPosition={menu}
          items={menu == null ? [] : [...flowActions(menu.flow), exportShown()]}
          onClose={() => setMenu(null)}
        />
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
  // A failure's reason, or Cancelled, takes the type and size cells together.
  const spanReason = noResponse && ids.includes("type") && ids.includes("size");
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
        "absolute top-0 inset-x-0 grid items-center gap-x-3 px-1.5 rounded-md whitespace-nowrap",
        "[&>*]:overflow-hidden [&>*]:text-ellipsis [&>*]:min-w-0 tabular-nums",
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
          <FlowCell key={c.id} column={c.id} flow={flow} span={spanReason && c.id === "type"} />
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
  const title = states.length === 0 ? undefined : states.join("\n");
  return (
    <span className="flex items-center justify-center" title={title}>
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
}

const mono = "font-mono text-xs";

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
        <span className={classNames(mono, "text-right text-text-subtlest")}>
          {flow.number || ""}
        </span>
      );
    case "app": {
      if (flow.clientPath == null) return <span />;
      const folder = folderOf(flow);
      const name = flow.clientName ?? flow.clientPath;
      return (
        <span className="flex items-center" title={folder == null ? name : `${name} in ${folder}`}>
          <AppIcon path={flow.clientPath} />
        </span>
      );
    }
    case "method":
      return (
        <HttpMethodTagRaw
          method={flow.method}
          short
          className={classNames(mono, !flow.cancelled && "text-text-subtle")}
        />
      );
    case "host":
      // Cut from the front, so the part that names the service stays.
      return (
        <span className={classNames("rtl text-left", !flow.cancelled && "text-text-subtle")}>
          <bdi>{hostOf(flow.url)}</bdi>
        </span>
      );
    case "path": {
      // A tunnel's only path is its host; what it carried is unread.
      if (flow.tunnelled) return <span className="text-text-subtlest">Not decrypted</span>;
      const { path, query } = splitPath(flow.url);
      if (flow.streamKind == null) {
        return (
          <span>
            {path}
            <span className="text-text-subtlest">{query}</span>
          </span>
        );
      }
      // A stream's message count rides the end of the path, so it survives the narrow width,
      // ticking while the stream is open.
      return (
        <span className="flex items-center">
          <span className="truncate">
            {path}
            <span className="text-text-subtlest">{query}</span>
          </span>
          <CountBadge
            count={flow.messageCount}
            showZero
            color={isOpenStream(flow) ? "info" : undefined}
            className="shrink-0 !mb-0 tabular-nums"
          />
        </span>
      );
    }
    case "status":
      return (flow.cancelled || flow.tunnelled) && flow.status == null ? (
        <span className={classNames(mono, "text-text-subtlest")}>--</span>
      ) : (
        <HttpStatusTagRaw status={flow.status ?? 0} short className={mono} />
      );
    case "type":
      return failed && noResponse ? (
        <span
          className={classNames("text-danger text-xs", span && "col-span-2")}
          title={flow.error ?? undefined}
        >
          {flow.error}
        </span>
      ) : flow.cancelled && noResponse ? (
        <span className={classNames("text-xs", span && "col-span-2")}>Cancelled</span>
      ) : (
        <span className={classNames(mono, "text-text-subtlest")}>
          {shortContentType(flow.contentType) ?? "--"}
        </span>
      );
    case "size":
      return (
        <span
          className={classNames(
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
          <span className={classNames(mono, "text-right text-text-subtlest")}>
            {Number.isFinite(open) ? formatMillis(Math.max(0, open)) : "--"}
          </span>
        );
      }
      return (
        <span
          className={classNames(
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
        <span className={classNames(mono, "text-text-subtle")}>{flow.remoteAddr ?? "--"}</span>
      );
    case "version":
      return (
        <span className={classNames(mono, "text-text-subtle")}>
          {flow.upstreamHttpVersion ?? flow.clientHttpVersion}
        </span>
      );
  }
}

function splitPath(url: string): { path: string; query: string } {
  try {
    const u = new URL(url);
    return { path: u.pathname, query: u.search };
  } catch {
    return { path: url, query: "" };
  }
}
