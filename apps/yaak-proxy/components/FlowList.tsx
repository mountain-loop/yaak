import { useVirtualizer } from "@tanstack/react-virtual";
import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow } from "@yaakapp-internal/proxy-lib";
import {
  ContextMenu,
  formatMillis,
  HttpMethodTagRaw,
  HttpStatusTagRaw,
  Icon,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import type { CSSProperties, KeyboardEvent, MouseEvent, WheelEvent } from "react";
import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { selectedFlowAtom, selectedFlowIdAtom } from "../lib/atoms";
import { shortContentType } from "../lib/body";
import { useFlowActions } from "../lib/flowActions";
import { compareFlows } from "../lib/flowWindow";
import { countNewFlows } from "../lib/follow";
import {
  activeQueryAtom,
  followAtom,
  hasAppsAtom,
  loadOlderFlowsAtom,
  newestStartedAtAtom,
  oldestFlowAtom,
  searchWindowAtom,
  shownFlowsAtom,
} from "../lib/store";
import { AppIcon } from "./AppIcon";
import { SearchBar } from "./SearchBar";

const ROW_HEIGHT = 24;
const BOTTOM_PADDING = 6;
/** Rows from the top at which older flows start loading */
const LOAD_OLDER_ROWS = 20;

interface Props {
  sideBySide: boolean;
  style?: CSSProperties;
  className?: string;
}

/**
 * Follows new traffic until a flow is selected or the list is scrolled, then holds. Scrolling to
 * the top loads older flows from the database.
 */
export function FlowList({ sideBySide, style, className }: Props) {
  const flows = useAtomValue(shownFlowsAtom);
  const hasApps = useAtomValue(hasAppsAtom);
  const [menu, setMenu] = useState<{ flow: Flow; x: number; y: number } | null>(null);
  const flowActions = useFlowActions();
  const selectedId = useAtomValue(selectedFlowIdAtom);
  const setSelectedFlow = useSetAtom(selectedFlowAtom);
  const loadOlder = useSetAtom(loadOlderFlowsAtom);
  const oldestFlow = useAtomValue(oldestFlowAtom);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ignoreScroll = useRef(false);
  const [following, setFollowing] = useAtom(followAtom);
  const [heldAt, setHeldAt] = useState<string | null>(null);
  // The newest flow across all traffic, not just this list, so a filter change keeps the hold
  const newestStartedAt = useAtomValue(newestStartedAtAtom);
  // Read by the callbacks below, which stay the same across new traffic so rows don't re-render
  const latest = useRef({ flows, following, newestStartedAt });
  useLayoutEffect(() => {
    latest.current = { flows, following, newestStartedAt };
  });

  const virtualizer = useVirtualizer({
    count: flows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => flows[index]?.id ?? index,
    paddingEnd: BOTTOM_PADDING,
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
    setFollowing(true);
    setHeldAt(null);
    setScrollTop(Number.MAX_SAFE_INTEGER);
  }, [setFollowing, setScrollTop]);

  useLayoutEffect(() => {
    if (following) setScrollTop(Number.MAX_SAFE_INTEGER);
  }, [following, flows, setScrollTop]);

  // Older flows that loaded in above push the rows down; scroll by as much, so they stay put.
  const anchor = useRef<Flow | null>(null);
  useLayoutEffect(() => {
    const previous = anchor.current;
    anchor.current = oldestFlow;
    if (following || previous == null || oldestFlow == null) return;
    if (compareFlows(oldestFlow, previous) >= 0) return;
    const added = flows.findIndex((f) => compareFlows(f, previous) >= 0);
    const el = scrollRef.current;
    if (added > 0 && el != null) setScrollTop(el.scrollTop + added * ROW_HEIGHT);
  }, [oldestFlow, flows, following, setScrollTop]);

  const loadOlderHeld = useCallback(() => {
    hold();
    void loadOlder();
  }, [hold, loadOlder]);

  const handleScroll = useCallback(() => {
    if (ignoreScroll.current) {
      ignoreScroll.current = false;
      return;
    }
    const el = scrollRef.current;
    if (el == null) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 2;
    if (atEnd) {
      setFollowing(true);
      setHeldAt(null);
    } else {
      hold();
      if (el.scrollTop < LOAD_OLDER_ROWS * ROW_HEIGHT) void loadOlder();
    }
  }, [hold, loadOlder, setFollowing]);

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
    [hold, setSelectedFlow, setScrollTop],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const index = flows.findIndex((f) => f.id === selectedId);
      if (index === -1) select(e.key === "ArrowDown" ? 0 : flows.length - 1);
      else if (index === 0 && e.key === "ArrowUp") loadOlderHeld();
      else select(e.key === "ArrowDown" ? index + 1 : index - 1);
    },
    [flows, loadOlderHeld, select, selectedId],
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

  const newCount = following ? 0 : countNewFlows(flows, heldAt);

  const columns = sideBySide
    ? hasApps
      ? "grid-cols-[0.9rem_1rem_2.6rem_minmax(0,2fr)_minmax(0,3fr)_2.4rem_3.6rem]"
      : "grid-cols-[0.9rem_2.6rem_minmax(0,2fr)_minmax(0,3fr)_2.4rem_3.6rem]"
    : hasApps
      ? "grid-cols-[0.9rem_8.5rem_2.6rem_13rem_minmax(0,1fr)_2.4rem_5rem_4.5rem_3.8rem]"
      : "grid-cols-[0.9rem_2.6rem_13rem_minmax(0,1fr)_2.4rem_5rem_4.5rem_3.8rem]";

  return (
    <div
      style={style}
      className={classNames(className, "grid grid-rows-[auto_auto_minmax(0,1fr)] min-h-0 text-sm")}
    >
      <SearchBar />
      <div
        className={classNames(
          columns,
          "grid items-center gap-x-3 h-[26px] px-1.5 mx-1.5",
          "text-text-subtlest border-b border-surface-highlight",
        )}
      >
        <span />
        {hasApps && <span>{sideBySide ? "" : "App"}</span>}
        <span>Method</span>
        <span>Host</span>
        <span>Path</span>
        <span>Status</span>
        {!sideBySide && <span>Type</span>}
        {!sideBySide && <span className="text-right">Size</span>}
        <span className="text-right">Time</span>
      </div>
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
            <EmptyList />
          ) : (
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const flow = flows[item.index];
                if (flow == null) return null;
                return (
                  <FlowRow
                    key={flow.id}
                    flow={flow}
                    index={item.index}
                    start={item.start}
                    columns={columns}
                    sideBySide={sideBySide}
                    showApp={hasApps}
                    selected={flow.id === selectedId}
                    onSelect={select}
                    onContextMenu={openMenu}
                  />
                );
              })}
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
              "bg-surface border border-border shadow-lg text-text text-xs",
              "hover:bg-surface-highlight",
            )}
          >
            <Icon icon="arrow_down_to_line" size="sm" color="primary" />
            {newCount === 1 ? "1 new flow" : `${newCount} new flows`}
          </button>
        )}
        <ContextMenu
          triggerPosition={menu}
          items={menu == null ? [] : flowActions(menu.flow)}
          onClose={() => setMenu(null)}
        />
      </div>
    </div>
  );
}

/** Nothing to list, or nothing a search matches */
function EmptyList() {
  const query = useAtomValue(activeQueryAtom);
  const search = useAtomValue(searchWindowAtom);
  if (search?.loading) return null;
  return (
    <p className="text-text-subtlest text-sm px-3 py-3">
      {query == null ? "No traffic yet" : "No flows match"}
    </p>
  );
}

interface RowProps {
  flow: Flow;
  index: number;
  start: number;
  columns: string;
  sideBySide: boolean;
  showApp: boolean;
  selected: boolean;
  onSelect: (index: number) => void;
  onContextMenu: (index: number, e: MouseEvent) => void;
}

const FlowRow = memo(function FlowRow({
  flow,
  index,
  start,
  columns,
  sideBySide,
  showApp,
  selected,
  onSelect,
  onContextMenu,
}: RowProps) {
  const { host, path, query } = splitUrl(flow.url);
  const failed = flow.error != null;
  // Failed before any response; an error after the headers is a body cut short mid-way.
  const noResponse = failed && flow.status == null;
  const type = shortContentType(flow.contentType);

  return (
    <div
      role="option"
      aria-selected={selected}
      onMouseDown={(e) => {
        if (e.button === 0) onSelect(index);
      }}
      onContextMenu={(e) => onContextMenu(index, e)}
      style={{ height: ROW_HEIGHT, transform: `translateY(${start}px)` }}
      className={classNames(
        columns,
        "absolute top-0 inset-x-0 grid items-center gap-x-3 px-1.5 rounded-md whitespace-nowrap",
        "[&>*]:overflow-hidden [&>*]:text-ellipsis [&>*]:min-w-0",
        selected
          ? "text-text bg-surface-highlight group-focus-within/flows:bg-surface-active"
          : index % 2 === 1 && "bg-surface-highlight/30",
      )}
    >
      <span className="flex items-center justify-center">
        {flow.savedRequestId != null ? (
          <Icon icon="bookmark" size="xs" color="primary" title="Saved to Yaak" />
        ) : failed ? (
          <Icon icon="circle_alert" size="xs" color="danger" />
        ) : flow.responseTruncated ? (
          <Icon icon="scissors" size="xs" color="notice" title="Body cut at the capture limit" />
        ) : null}
      </span>
      {showApp && (
        <span className="flex items-center gap-1.5" title={flow.clientPath ?? undefined}>
          {flow.clientPath != null && <AppIcon path={flow.clientPath} />}
          {!sideBySide && (
            <span className="truncate text-text-subtle">
              {flow.clientName ?? <span className="text-text-subtlest">--</span>}
            </span>
          )}
        </span>
      )}
      <HttpMethodTagRaw method={flow.method} short colored />
      <span className="text-text-subtle">{host}</span>
      <span>
        {path}
        <span className="text-text-subtlest">{query}</span>
      </span>
      <HttpStatusTagRaw status={flow.status ?? 0} short />
      {!sideBySide &&
        (failed ? (
          <span className="text-danger" title={flow.error ?? undefined}>
            {flow.error}
          </span>
        ) : (
          <span className="text-text-subtle">
            {type ?? <span className="text-text-subtlest">--</span>}
          </span>
        ))}
      {!sideBySide && (
        <span
          className={classNames(
            "font-mono text-right",
            flow.responseTruncated ? "text-notice" : "text-text-subtle",
          )}
        >
          {noResponse ? (
            <span className="text-text-subtlest">--</span>
          ) : (
            formatSize(flow.responseSize)
          )}
        </span>
      )}
      <span className="font-mono text-right text-text-subtle">
        {flow.elapsedMs == null ? "--" : formatMillis(flow.elapsedMs)}
      </span>
    </div>
  );
});

function splitUrl(url: string): { host: string; path: string; query: string } {
  try {
    const u = new URL(url);
    return { host: u.host, path: u.pathname, query: u.search };
  } catch {
    return { host: "", path: url, query: "" };
  }
}
