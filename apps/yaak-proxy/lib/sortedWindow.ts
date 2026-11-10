import type { Flow, FlowSortKey, ModelPayload, SortValue } from "@yaakapp-internal/proxy-lib";
import type { FlowQuery } from "./query";

/**
 * The flows the list shows while it is sorted: read from the database in the sort's order, a
 * page at a time from the top, as `list_flows` orders them for `sort`. Flows that change are
 * placed by the same comparison, and only up to where the pages read end, so paging on never
 * skips or repeats one.
 */
export interface SortedWindow {
  /** Unique to this load, so a page read for an earlier sort or search is dropped */
  key: string;
  sort: FlowSortKey[];
  query: FlowQuery | null;
  /** In the sort's order */
  flows: Flow[];
  /**
   * The last flow of the last page, as it was read, while the database has more after it: where
   * the next page starts. Null once every flow is read.
   */
  boundary: Flow | null;
  /** The next page's `cursor`, from the last page: the boundary's sort values as read */
  cursor: SortValue[] | null;
  /** The first page has not arrived yet */
  loading: boolean;
  /** Changes that came while the first page loaded, applied once it is in */
  buffered: ModelPayload[];
}

/** Where `flow` goes in `flows`, which `compare` orders */
function insertionIndex(flows: Flow[], flow: Flow, compare: (a: Flow, b: Flow) => number): number {
  let lo = 0;
  let hi = flows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const item = flows[mid];
    if (item != null && compare(item, flow) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Applies flow events to a sorted window's flows: a changed flow moves to where `compare` puts
 * it, a deleted one leaves, and one that sorts after `boundary`, where the pages read end, is
 * left for paging. With `searchKey`, only flows the backend matched against that search join or
 * stay; a flow matched against another search is left as it is, to be matched again.
 */
export function applySortedChanges(
  flows: Flow[],
  boundary: Flow | null,
  changes: ModelPayload[],
  compare: (a: Flow, b: Flow) => number,
  searchKey: string | null,
): Flow[] {
  if (changes.length === 0) return flows;
  const next = flows.slice();
  for (const c of changes) {
    const deleted = c.change.type === "delete";
    if (!deleted && searchKey != null && c.search?.key !== searchKey) continue;
    const existing = next.findIndex((f) => f.id === c.model.id);
    if (existing !== -1) next.splice(existing, 1);
    if (deleted || (searchKey != null && c.search?.matches !== true)) continue;
    if (boundary != null && compare(c.model, boundary) > 0) continue;
    next.splice(insertionIndex(next, c.model, compare), 0, c.model);
  }
  return next;
}

/** A page from `list_flows` as a sorted window takes it: where it ends, and where the next starts */
export function pageBoundary(
  page: Flow[],
  cursor: SortValue[] | null,
  limit: number,
): Pick<SortedWindow, "boundary" | "cursor"> {
  const more = page.length >= limit;
  return { boundary: more ? (page.at(-1) ?? null) : null, cursor: more ? cursor : null };
}

/**
 * Adds the next page from `list_flows`, read after the window's boundary, less any it has and
 * any `keep` leaves out
 */
export function appendPage(
  win: SortedWindow,
  page: Flow[],
  cursor: SortValue[] | null,
  limit: number,
  keep: (flow: Flow) => boolean = () => true,
): SortedWindow {
  const held = new Set(win.flows.map((f) => f.id));
  return {
    ...win,
    flows: [...win.flows, ...page.filter((f) => !held.has(f.id) && keep(f))],
    ...pageBoundary(page, cursor, limit),
  };
}
