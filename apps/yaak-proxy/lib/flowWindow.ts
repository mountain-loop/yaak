import type { Flow, ModelPayload } from "@yaakapp-internal/proxy-lib";

/** Flows the window keeps while it follows new traffic */
export const WINDOW_SIZE = 2000;
/**
 * Flows past `WINDOW_SIZE` before the oldest are dropped, so they go a few hundred at a time
 * rather than one per new flow, which would shift every row of the list each time.
 */
export const WINDOW_SLACK = 500;
/** Older flows loaded per page on scrolling to the top */
export const PAGE_SIZE = 500;

/**
 * The flows the app holds in memory: the newest in the database, oldest first, ordered by start
 * and then id as `list_flows` orders them. The database keeps every flow; older ones load back
 * in pages.
 */
export interface FlowWindow {
  flows: Flow[];
  /** The database has flows older than the first one here */
  hasOlder: boolean;
  /** Flows in the database */
  total: number;
}

export const emptyWindow: FlowWindow = { flows: [], hasOlder: false, total: 0 };

type FlowKey = Pick<Flow, "startedAt" | "id">;

export function compareFlows(a: FlowKey, b: FlowKey): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** The window from the newest page of `list_flows`, which comes newest first */
export function windowFromPage(page: Flow[], limit: number, total: number): FlowWindow {
  return { flows: [...page].reverse(), hasOlder: page.length >= limit, total };
}

/**
 * Adds new flows where they belong and replaces changed ones. New traffic almost always lands at
 * the end, so this is an append. A flow that started before the oldest one held, while older ones
 * are still in the database, is left for paging to load, so the window never has a gap.
 */
export function applyChanges(win: FlowWindow, changes: ModelPayload[]): FlowWindow {
  if (changes.length === 0) return win;
  const flows = win.flows.slice();
  let total = win.total;
  for (const { model, change } of changes) {
    const i = insertionIndex(flows, model);
    const existing = flows[i]?.id === model.id;
    if (change.type === "delete") {
      if (existing) flows.splice(i, 1);
      total = Math.max(0, total - 1);
    } else if (existing) {
      flows[i] = model;
    } else {
      if (change.created) total++;
      const first = flows[0];
      if (win.hasOlder && first != null && compareFlows(model, first) < 0) continue;
      flows.splice(i, 0, model);
    }
  }
  return { ...win, flows, total };
}

/**
 * Drops the oldest flows once there are `slack` more than `size`, back down to `size`. Always an
 * even number of them, so the list's alternating rows keep their shade.
 */
export function trimWindow(win: FlowWindow, size = WINDOW_SIZE, slack = WINDOW_SLACK): FlowWindow {
  if (win.flows.length <= size + slack) return win;
  let drop = win.flows.length - size;
  drop += drop % 2;
  return { ...win, flows: win.flows.slice(drop), hasOlder: true };
}

/** Adds a page of older flows from `list_flows`, newest first, before the oldest one held */
export function prependOlder(win: FlowWindow, page: Flow[], limit: number): FlowWindow {
  const first = win.flows[0];
  const older = page.filter((f) => first == null || compareFlows(f, first) < 0).reverse();
  return { ...win, flows: [...older, ...win.flows], hasOlder: page.length >= limit };
}

/** Where `flow` is, or would go, in `flows` */
function insertionIndex(flows: FlowKey[], flow: FlowKey): number {
  // New traffic goes at the end; skip the search for it.
  const last = flows[flows.length - 1];
  if (last == null || compareFlows(last, flow) < 0) return flows.length;
  let lo = 0;
  let hi = flows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const item = flows[mid];
    if (item != null && compareFlows(item, flow) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
