import type {
  Flow,
  FlowSortKey,
  GetProxyStateResponse,
  ModelPayload,
  SavedQuery,
  SortValue,
} from "@yaakapp-internal/proxy-lib";
import { atom, type createStore } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { appliedFilterAtom, dropSelectedAtom, followingAtom, selectedFlowAtom } from "./atoms";
import {
  type ColumnPrefs,
  defaultColumnPrefs,
  parseColumnPrefs,
  sortComparator,
  sortFlows,
} from "./columns";
import { appendPage, applySortedChanges, pageBoundary, type SortedWindow } from "./sortedWindow";
import {
  applyChanges,
  emptyWindow,
  type FlowWindow,
  PAGE_SIZE,
  prependOlder,
  trimWindow,
  WINDOW_SIZE,
  windowFromPage,
} from "./flowWindow";
import { activeQuery, anyCountsBackFromNow, countsBackFromNow, type FlowQuery } from "./query";
import { listen, rpc } from "./rpc";
import { changesFor, FlowEvents } from "./searchChanges";
import { buildSidebarTree, type SavedRow } from "./sidebarTree";

export type Store = ReturnType<typeof createStore>;

/** How long new flows gather before they reach the list, so a burst renders once */
const FLUSH_MS = 100;
/** How long after new flows the total is counted again from the database */
const RECOUNT_MS = 1000;
/** How often the database is read for new flows while another process owns the engine */
const POLL_MS = 1000;
/** How often a search counting back from now is read again, as flows age in and out of it */
const AGE_REFRESH_MS = 15_000;
/** How often the engine's owner is checked while it is another process */
const OWNER_POLL_MS = 2000;

/** The flows in memory: a window onto the database, which keeps them all */
export const flowWindowAtom = atom<FlowWindow>(emptyWindow);

/** Oldest first, so new traffic arrives at the end of the list */
export const flowsAtom = atom((get) => get(flowWindowAtom).flows);

/** Start of the newest flow held, across all traffic */
export const newestStartedAtAtom = atom((get) => get(flowsAtom).at(-1)?.startedAt ?? null);

/** Flows in the database */
export const flowTotalAtom = atom((get) => get(flowWindowAtom).total);

/** The first page of flows has loaded, so an empty window means an empty database */
export const flowsLoadedAtom = atom(false);

/**
 * The database has no flows and nothing narrows the list. A boolean of its own, so new traffic
 * does not re-render what reads it.
 */
export const noFlowsAtom = atom(
  (get) => get(flowsLoadedAtom) && get(flowTotalAtom) === 0 && get(appliedFilterAtom).trim() === "",
);

/** The system proxy has been on at some point since this install, which first run waits for */
export const systemProxyEverOnAtom = atomWithStorage("system_proxy_ever_on", false, undefined, {
  getOnInit: true,
});

/** Some flow held names the app that sent it, which only some platforms can tell */
export const hasAppsAtom = atom((get) => get(flowsAtom).some((f) => f.clientName != null));

/** System's flows are left out of All traffic, by Show in All Traffic in System's menu */
export const hideSystemAtom = atomWithStorage("sidebar_hide_system", false, undefined, {
  getOnInit: true,
});

/** The search the list shows, from the filter applied, or null for all traffic */
export const activeQueryAtom = atom<FlowQuery | null>((get) =>
  activeQuery(get(appliedFilterAtom), get(hideSystemAtom)),
);

/** The saved searches, in their order */
export const savedQueriesAtom = atom<SavedQuery[]>([]);

/** How many flows each saved search covers, by id, counted in the database */
export const savedCountsAtom = atom<Record<string, number>>({});

/** The saved searches as the sidebar lists them */
const savedRowsAtom = atom<SavedRow[]>((get) => {
  const counts = get(savedCountsAtom);
  return get(savedQueriesAtom).map((s) => ({
    id: s.id,
    name: s.name,
    query: s.query,
    count: counts[s.id] ?? 0,
  }));
});

/** Flows All traffic covers in the database: every one, or all but System's while hidden */
export const allTrafficTotalAtom = atom((get) =>
  get(hideSystemAtom) ? get(nonSystemTotalAtom) : get(flowTotalAtom),
);

/** Flows in the database not from System, counted while System is hidden */
export const nonSystemTotalAtom = atom(0);

/**
 * The flows the sidebar counts: the window's, taken at most once a second, so a burst of traffic
 * rebuilds its trees once rather than on every batch
 */
export const sidebarFlowsAtom = atom<Flow[]>([]);

/** How long the sidebar's counts may lag the list */
const SIDEBAR_MS = 1000;

/** The sidebar's rows, from the flows loaded */
export const sidebarTreeAtom = atom((get) =>
  buildSidebarTree(get(sidebarFlowsAtom), get(allTrafficTotalAtom), get(savedRowsAtom)),
);

const storedColumnPrefsAtom = atomWithStorage<unknown>(
  "flow_columns",
  defaultColumnPrefs,
  undefined,
  {
    getOnInit: true,
  },
);

/** Which columns the list shows, how wide, and its sort, as the person left them */
export const columnPrefsAtom = atom(
  (get) => parseColumnPrefs(get(storedColumnPrefsAtom)),
  (get, set, update: ColumnPrefs | ((prev: ColumnPrefs) => ColumnPrefs)) => {
    const prev = parseColumnPrefs(get(storedColumnPrefsAtom));
    set(storedColumnPrefsAtom, typeof update === "function" ? update(prev) : update);
  },
);

/** The list's sort keys, in order, kept with the columns; empty for the order flows arrive in */
export const flowSortAtom = atom(
  (get) => get(columnPrefsAtom).sort,
  (_get, set, sort: FlowSortKey[]) => set(columnPrefsAtom, (p) => ({ ...p, sort })),
);

/** The flows the list shows while sorted, read from the database in the sort's order */
export const sortedWindowAtom = atom<SortedWindow | null>(null);

/** A window onto the flows a search covers, loaded from the database as the main one is */
export interface SearchWindow {
  key: string;
  query: FlowQuery;
  win: FlowWindow;
  /** The first page has not arrived yet */
  loading: boolean;
  /** Changes that came while the first page loaded, applied once it is in */
  buffered: ModelPayload[];
}

export const searchWindowAtom = atom<SearchWindow | null>(null);

/** The window the list shows: the search's, or all traffic's */
const shownWindowAtom = atom((get) => get(searchWindowAtom)?.win ?? get(flowWindowAtom));

/** The flows loaded for the list, oldest first */
export const windowFlowsAtom = atom((get) => get(shownWindowAtom).flows);

/**
 * The flows the list shows: oldest first, or in the sort's order from the database. Until a
 * sort's first page is in, the flows loaded, sorted here, stand in for it.
 */
export const shownFlowsAtom = atom((get) => {
  const sort = get(flowSortAtom);
  if (sort.length === 0) return get(windowFlowsAtom);
  const sorted = get(sortedWindowAtom);
  if (sorted == null || (sorted.loading && sorted.flows.length === 0)) {
    return sortFlows(get(windowFlowsAtom), sort);
  }
  return sorted.flows;
});

/** Flows in the database the list covers: every one, or those the search matches */
export const shownTotalAtom = atom((get) => get(shownWindowAtom).total);

/** The search's first page has not arrived, so the list shows none of its flows yet */
export const searchLoadingAtom = atom((get) => get(searchWindowAtom)?.loading ?? false);

/** Start and id of the oldest flow shown, which loading older flows moves back */
export const oldestFlowAtom = atom((get) => get(windowFlowsAtom)[0] ?? null);

/** Follows new traffic, dropping the older flows scrolling up loaded, or holds the list */
export const followAtom = atom(
  (get) => get(followingAtom),
  (_get, set, following: boolean) => {
    set(followingAtom, following);
    if (!following) return;
    set(flowWindowAtom, (win) => trimWindow(win));
    set(searchWindowAtom, (s) => (s == null ? s : { ...s, win: trimWindow(s.win) }));
  },
);

/** The engine's state, kept current from its events, and polled while another process has it */
export const proxyStateAtom = atom<GetProxyStateResponse | null>(null);

/** Why captured traffic can't be read, while it can't: nothing that reads it is offered then */
export const lockedAtom = atom((get) => get(proxyStateAtom)?.locked ?? null);

/** When recording was seen to pause, in this session; null while recording or not known */
export const pausedAtAtom = atom<number | null>(null);

/**
 * Changes applied while a page of older flows loads, or null when none is loading. A slow flow
 * that ends meanwhile may be older than the window, so left out of it, and missing from a page
 * read before it was written; applying these again once the page is in keeps it.
 */
let changesDuringPage: ModelPayload[] | null = null;

/**
 * Flows the keep-traffic sweep deleted while a page was being read: the page may be a snapshot
 * from before, so it is filtered by these as it lands. Forgotten once no page is being read.
 */
const removedWhileLoading = new Set<string>();
let pagesLoading = 0;

function pageStarted() {
  pagesLoading++;
}

function pageSettled() {
  pagesLoading = Math.max(0, pagesLoading - 1);
  if (pagesLoading === 0) removedWhileLoading.clear();
}

/** A page's flows less any the sweep deleted since it was asked for */
function withoutRemoved(flows: Flow[]): Flow[] {
  return removedWhileLoading.size === 0
    ? flows
    : flows.filter((f) => !removedWhileLoading.has(f.id));
}

/** Changes still to apply, less the ones that would bring back a deleted flow */
function dropRemovedChanges(changes: ModelPayload[], removed: Set<string>) {
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    if (c != null && c.change.type !== "delete" && removed.has(c.model.id)) changes.splice(i, 1);
  }
}

/** Loads the page of flows before the oldest one shown, from the search's flows when searching */
export const loadOlderFlowsAtom = atom(null, async (get, set) => {
  const search = get(searchWindowAtom);
  const { flows, hasOlder } = search?.win ?? get(flowWindowAtom);
  const first = flows[0];
  if (changesDuringPage != null || !hasOlder || first == null) return;
  const changes: ModelPayload[] = [];
  changesDuringPage = changes;
  pageStarted();
  try {
    const res = await rpc("list_flows", { ...search?.query, before: first.id, limit: PAGE_SIZE });
    // Dropped when the window moved on meanwhile, trimmed, cleared or searched again.
    const merge = (win: FlowWindow) => {
      if (win.flows[0]?.id !== first.id) return win;
      const merged = prependOlder(win, withoutRemoved(res.flows), PAGE_SIZE);
      const kept = search == null ? changes : changesOf(search, merged, changes);
      // Counted when they first applied.
      return { ...applyChanges(merged, kept), total: merged.total };
    };
    if (search == null) {
      set(flowWindowAtom, merge);
    } else {
      set(searchWindowAtom, (s) => (s?.key === search.key ? { ...s, win: merge(s.win) } : s));
    }
  } catch (err) {
    console.warn("Failed to load older flows", err);
  } finally {
    changesDuringPage = null;
    pageSettled();
  }
});

/** Changes applied while a page of a sort loads, applied again over it once it is in */
let changesDuringSortedPage: ModelPayload[] | null = null;

/** The key flow events mark matches of the search shown with, or null for all traffic */
function searchKeyOf(search: SearchWindow | null): string | null {
  return search?.key ?? null;
}

/** Loads the sort's next page, after the last flow shown, on scrolling to the bottom */
export const loadMoreSortedAtom = atom(null, async (get, set) => {
  const win = get(sortedWindowAtom);
  const cursor = win?.cursor;
  if (win == null || win.loading || win.boundary == null || cursor == null) return;
  if (changesDuringSortedPage != null) return;
  const changes: ModelPayload[] = [];
  changesDuringSortedPage = changes;
  pageStarted();
  try {
    const res = await rpc("list_flows", {
      ...win.query,
      sort: win.sort,
      cursor,
      limit: PAGE_SIZE,
    });
    set(sortedWindowAtom, (s) => {
      if (s?.key !== win.key || s.cursor !== cursor) return s;
      const kept = new Set(withoutRemoved(res.flows).map((f) => f.id));
      const merged = appendPage(s, res.flows, res.cursor, PAGE_SIZE, (f) => kept.has(f.id));
      const compare = sortComparator(s.sort);
      const key = searchKeyOf(get(searchWindowAtom));
      return {
        ...merged,
        flows: applySortedChanges(merged.flows, merged.boundary, changes, compare, key),
      };
    });
  } catch (err) {
    // Read the sort again from its top.
    console.warn("Failed to load more sorted flows", err);
    reloadSorted?.();
  } finally {
    changesDuringSortedPage = null;
    pageSettled();
  }
});

/** Reads the sort's first page again, once `syncFlows` has started */
let reloadSorted: (() => void) | null = null;

/** `changesFor`, with flows matched against another search sent to be matched again */
function changesOf(
  search: Pick<SearchWindow, "key" | "query">,
  win: FlowWindow,
  changes: ModelPayload[],
): ModelPayload[] {
  return changesFor(search.key, win, changes, (unknown) => matchLater(search, unknown));
}

/** The store `syncFlows` keeps, for answers that come after the changes they are for */
let syncedStore: Store | null = null;

/** The order flow events arrived in, for judging answers that come late */
const flowEvents = new FlowEvents();

/**
 * Matches flows against the search in the database, then has its window take them as it takes
 * events matched as they were sent. A flow a newer event updated or removed meanwhile, in the
 * window or not, keeps what that event left.
 */
function matchLater(search: Pick<SearchWindow, "key" | "query">, changes: ModelPayload[]) {
  const store = syncedStore;
  if (store == null) return;
  const ids = [...new Set(changes.map((c) => c.model.id))];
  rpc("match_flows", { filter: search.query, ids })
    .then((matched) => {
      const covered = new Set(matched);
      const marked = flowEvents.current(changes).map((c) => ({
        ...c,
        search: { key: search.key, matches: covered.has(c.model.id) },
      }));
      if (marked.length === 0) return;
      applySortedChangesTo(store, marked);
      const following = store.get(followingAtom);
      store.set(searchWindowAtom, (s) => {
        if (s?.key !== search.key) return s;
        if (s.loading) return { ...s, buffered: [...s.buffered, ...marked] };
        const next = applyChanges(s.win, changesOf(s, s.win, marked));
        return { ...s, win: following ? trimWindow(next) : next };
      });
    })
    .catch((err) => console.warn("Failed to match flows", err));
}

/** Applies flow events to the sorted window, or holds them while its first page loads */
function applySortedChangesTo(store: Store, changes: ModelPayload[]) {
  if (store.get(sortedWindowAtom) == null) return;
  changesDuringSortedPage?.push(...changes);
  const key = searchKeyOf(store.get(searchWindowAtom));
  store.set(sortedWindowAtom, (s) => {
    if (s == null) return s;
    if (s.loading) return { ...s, buffered: [...s.buffered, ...changes] };
    const flows = applySortedChanges(s.flows, s.boundary, changes, sortComparator(s.sort), key);
    return flows === s.flows ? s : { ...s, flows };
  });
}

/**
 * Loads the newest flows, then keeps them current with the engine's events, or with reads of the
 * database while another process owns the engine. Events gather for `FLUSH_MS` and apply
 * together, and the window drops its oldest flows while the list follows, so a new flow costs the
 * same however many the database holds. A search gets a window of its own, kept current the same
 * way.
 */
export function syncFlows(store: Store) {
  syncedStore = store;
  let pending: ModelPayload[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loaded = false;
  let loads = 0;
  let searchLoads = 0;
  /** A flow written at or before the newest the app has seen, for reading new ones after it */
  let seenId: string | null = null;

  function flush() {
    timer = null;
    if (!loaded || pending.length === 0) return;
    const changes = pending;
    pending = [];
    changesDuringPage?.push(...changes);
    const following = store.get(followingAtom);
    store.set(flowWindowAtom, (win) => {
      const next = applyChanges(win, changes);
      return following ? trimWindow(next) : next;
    });
    store.set(searchWindowAtom, (s) => {
      if (s == null) return s;
      // A matching flow written after the page's snapshot would otherwise be missed.
      if (s.loading) return { ...s, buffered: [...s.buffered, ...changes] };
      const next = applyChanges(s.win, changesOf(s, s.win, changes));
      return { ...s, win: following ? trimWindow(next) : next };
    });
    applySortedChangesTo(store, changes);
    const selected = store.get(selectedFlowAtom);
    const change = changes.findLast((c) => c.model.id === selected?.id);
    if (change?.change.type === "delete") store.set(dropSelectedAtom, new Set([change.model.id]));
    else if (change != null) store.set(selectedFlowAtom, change.model);
    if (recountTimer == null) recountTimer = setTimeout(recount, RECOUNT_MS);
  }

  function receive(changes: ModelPayload[]) {
    flowEvents.arrived(changes);
    pending.push(...changes);
    if (timer == null) timer = setTimeout(flush, FLUSH_MS);
  }

  // The total counts each new flow as it comes, which a flow both in a page and in the events
  // around it can count twice or not at all; a count from the database a moment later settles it.
  let recountTimer: ReturnType<typeof setTimeout> | null = null;
  function recount() {
    recountTimer = null;
    const thisLoad = loads;
    void rpc("list_flows", { limit: 0 }).then((res) => {
      if (thisLoad !== loads) return;
      store.set(flowWindowAtom, (win) =>
        win.total === res.total ? win : { ...win, total: res.total },
      );
    });
    if (store.get(hideSystemAtom)) {
      void rpc("list_flows", { hideSystem: true, limit: 0 }).then((res) => {
        if (thisLoad === loads) store.set(nonSystemTotalAtom, res.matching ?? res.total);
      });
    }
    countSaved();
    const search = store.get(searchWindowAtom);
    if (search == null || search.loading) return;
    void rpc("list_flows", { ...search.query, limit: 0 }).then((res) => {
      const total = res.matching ?? res.total;
      store.set(searchWindowAtom, (s) =>
        s?.key !== search.key || s.win.total === total ? s : { ...s, win: { ...s.win, total } },
      );
    });
  }

  // Saved searches, and their counts, which change with the traffic.
  function loadSaved() {
    rpc("list_saved_queries", {})
      .then((saved) => {
        store.set(savedQueriesAtom, saved);
        countSaved();
      })
      .catch((err) => console.warn("Failed to list saved searches", err));
  }
  let counting = false;
  let countAgain = false;
  function countSaved() {
    if (store.get(savedQueriesAtom).length === 0) return;
    // One count at a time; one asked for meanwhile runs after it, with the latest traffic.
    if (counting) {
      countAgain = true;
      return;
    }
    counting = true;
    rpc("count_saved_queries", { hideSystem: store.get(hideSystemAtom) })
      .then((counts) =>
        store.set(savedCountsAtom, Object.fromEntries(counts.map((c) => [c.id, c.count]))),
      )
      .catch((err) => console.warn("Failed to count saved searches", err))
      .finally(() => {
        counting = false;
        if (countAgain) {
          countAgain = false;
          countSaved();
        }
      });
  }
  listen("saved_queries_changed", loadSaved);
  loadSaved();

  listen("model_write", (payload) => {
    seenId = payload.model.id;
    receive([payload]);
  });

  // Loads again rather than only emptying, for a flow written between the clear and the event.
  // Saved searches too, which could not be read while the database was locked.
  listen("flows_cleared", () => {
    flowEvents.reset();
    store.set(emptyFlowsAtom);
    pending = [];
    load();
    loadSaved();
  });

  // The oldest flows, swept to keep the capture under its size limit: dropped wherever they
  // are held, and the totals counted again from the database.
  listen("flows_removed", ({ ids }) => {
    flowEvents.removed(ids);
    const removed = new Set(ids);
    const drop = (win: FlowWindow) =>
      win.flows.some((f) => removed.has(f.id))
        ? { ...win, flows: win.flows.filter((f) => !removed.has(f.id)) }
        : win;
    if (pagesLoading > 0) for (const id of ids) removedWhileLoading.add(id);
    dropRemovedChanges(pending, removed);
    if (changesDuringPage != null) dropRemovedChanges(changesDuringPage, removed);
    store.set(flowWindowAtom, drop);
    store.set(searchWindowAtom, (s) => {
      if (s == null) return s;
      const buffered = [...s.buffered];
      dropRemovedChanges(buffered, removed);
      return { ...s, win: drop(s.win), buffered };
    });
    if (changesDuringSortedPage != null) dropRemovedChanges(changesDuringSortedPage, removed);
    store.set(sortedWindowAtom, (s) => {
      if (s == null) return s;
      const buffered = [...s.buffered];
      dropRemovedChanges(buffered, removed);
      const flows = s.flows.some((f) => removed.has(f.id))
        ? s.flows.filter((f) => !removed.has(f.id))
        : s.flows;
      return { ...s, flows, buffered };
    });
    store.set(dropSelectedAtom, removed);
    if (recountTimer == null) recountTimer = setTimeout(recount, RECOUNT_MS);
  });

  function load() {
    loaded = false;
    const thisLoad = ++loads;
    pageStarted();
    void rpc("list_flows", { limit: WINDOW_SIZE })
      .then((res) => {
        // A clear since asked for a newer page.
        if (thisLoad !== loads) return;
        store.set(
          flowWindowAtom,
          windowFromPage(withoutRemoved(res.flows), WINDOW_SIZE, res.total),
        );
        seenId = res.flows[0]?.id ?? null;
        loaded = true;
        store.set(flowsLoadedAtom, true);
        // Flows recorded before this install remembered it mean setup was done.
        if (res.total > 0) store.set(systemProxyEverOnAtom, true);
        flush();
        recount();
      })
      .finally(pageSettled);
    loadSearch(store.get(activeQueryAtom));
    loadSorted();
  }
  reloadFlows = load;

  /**
   * Reads the first page of the list's sort from the database, over the search shown, or drops
   * the sorted window when there is no sort. Until the page is in, the flows loaded, sorted here,
   * stand in for it.
   */
  let sortedLoads = 0;
  function loadSorted() {
    const sort = store.get(flowSortAtom);
    if (sort.length === 0) {
      store.set(sortedWindowAtom, null);
      return;
    }
    const query = store.get(activeQueryAtom);
    const key = `${++sortedLoads}:${JSON.stringify({ sort, query })}`;
    store.set(sortedWindowAtom, {
      key,
      sort,
      query,
      flows: [],
      boundary: null,
      cursor: null,
      loading: true,
      buffered: [],
    });
    const settle = (page: Flow[] | null, cursor: SortValue[] | null) =>
      store.set(sortedWindowAtom, (s) => {
        if (s?.key !== key) return s;
        const ends = pageBoundary(page ?? [], cursor, PAGE_SIZE);
        const base = page == null ? s.flows : withoutRemoved(page);
        const search = searchKeyOf(store.get(searchWindowAtom));
        const compare = sortComparator(sort);
        const flows = applySortedChanges(base, ends.boundary, s.buffered, compare, search);
        return { ...s, ...ends, flows, loading: false, buffered: [] };
      });
    pageStarted();
    void rpc("list_flows", { ...query, sort, limit: PAGE_SIZE })
      .then((res) => settle(res.flows, res.cursor))
      .catch((err) => {
        console.warn("Failed to read the sorted flows", err);
        settle(null, null);
      })
      .finally(pageSettled);
  }
  reloadSorted = loadSorted;
  let sortJson = JSON.stringify(store.get(flowSortAtom));
  store.sub(flowSortAtom, () => {
    const json = JSON.stringify(store.get(flowSortAtom));
    if (json === sortJson) return;
    sortJson = json;
    loadSorted();
  });

  /**
   * Loads the first page of `query`'s flows into a window of its own, or drops it for null. The
   * backend matches the flows written from now on against it, and their events say so.
   */
  function loadSearch(query: FlowQuery | null, keepRows = false) {
    if (query == null) {
      store.set(searchWindowAtom, null);
      void rpc("watch_query", { key: "" }).catch(() => {});
      return;
    }
    // Unique to this load, so a slower answer to an earlier one with the same query, such as
    // one read before a clear, is dropped.
    const key = `${++searchLoads}:${JSON.stringify(query)}`;
    // Read again, it keeps showing its rows until the new ones are in.
    const win = (keepRows ? store.get(searchWindowAtom)?.win : null) ?? emptyWindow;
    store.set(searchWindowAtom, { key, query, win, loading: true, buffered: [] });
    void rpc("watch_query", { key, query: query.query, hideSystem: query.hideSystem }).catch(
      (err) => console.warn("Failed to watch the search", err),
    );
    const settle = (page: FlowWindow | null) =>
      store.set(searchWindowAtom, (s) => {
        if (s?.key !== key) return s;
        // Applied again over the page: a flow already in it is replaced, not added.
        const base = page ?? s.win;
        const win = applyChanges(base, changesOf(s, base, s.buffered));
        return {
          ...s,
          win: page == null ? win : { ...win, total: page.total },
          loading: false,
          buffered: [],
        };
      });
    pageStarted();
    void rpc("list_flows", { ...query, limit: WINDOW_SIZE })
      .then((res) =>
        settle(windowFromPage(withoutRemoved(res.flows), WINDOW_SIZE, res.matching ?? res.total)),
      )
      .catch((err) => {
        console.warn("Failed to search flows", err);
        settle(null);
      })
      .finally(pageSettled);
  }

  // The sidebar takes the window's flows at once when it empties or first fills, and at most
  // once a second otherwise.
  let sidebarTimer: ReturnType<typeof setTimeout> | null = null;
  const takeSidebarFlows = () => {
    sidebarTimer = null;
    store.set(sidebarFlowsAtom, store.get(flowsAtom));
  };
  store.sub(flowsAtom, () => {
    const now = store.get(flowsAtom).length;
    const before = store.get(sidebarFlowsAtom).length;
    if (now === 0 || before === 0) {
      if (sidebarTimer != null) clearTimeout(sidebarTimer);
      takeSidebarFlows();
    } else if (sidebarTimer == null) {
      sidebarTimer = setTimeout(takeSidebarFlows, SIDEBAR_MS);
    }
  });

  // All traffic's count, and the saved searches', leave System out while it is hidden.
  store.sub(hideSystemAtom, () => {
    if (loaded) recount();
  });

  // A search counting back from now, `@time:<5m`, is read again while it is shown and the list
  // follows new traffic, so flows leave it and join it as they age. Saved ones are counted
  // again, as their counts change with no traffic at all.
  setInterval(() => {
    if (anyCountsBackFromNow(store.get(savedQueriesAtom).map((q) => q.query))) countSaved();
    const s = store.get(searchWindowAtom);
    if (s == null || s.loading || !store.get(followingAtom)) return;
    if (countsBackFromNow(s.query.query)) loadSearch(s.query, true);
  }, AGE_REFRESH_MS);

  let activeKey = JSON.stringify(store.get(activeQueryAtom));
  store.sub(activeQueryAtom, () => {
    const query = store.get(activeQueryAtom);
    const key = JSON.stringify(query);
    if (key === activeKey) return;
    activeKey = key;
    loadSearch(query);
    loadSorted();
  });

  // While another process owns the engine no events come, so new flows are read from the
  // database. Reading after a flow that started last can return a slow one already seen, which
  // applies as an update; it never skips one.
  let polling = false;
  function readNewFlows() {
    if (polling || !loaded) return;
    polling = true;
    const after = seenId;
    const read =
      after == null
        ? rpc("list_flows", { limit: WINDOW_SIZE })
        : rpc("list_flows", { after, limit: WINDOW_SIZE });
    read
      .then((res) => {
        if (res.flows.length === 0) return;
        // More arrived than one read holds: load the newest again rather than leave a gap.
        if (res.flows.length >= WINDOW_SIZE) {
          load();
          return;
        }
        if (seenId === after) seenId = res.flows[0]?.id ?? seenId;
        const known = new Set(store.get(flowsAtom).map((f) => f.id));
        receive(
          [...res.flows].reverse().map((model) => ({
            model,
            change: { type: "upsert", created: !known.has(model.id) },
          })),
        );
      })
      // The flow read after was cleared: start again from the newest.
      .catch(() => {
        seenId = null;
        load();
      })
      .finally(() => {
        polling = false;
      });
  }
  setInterval(() => {
    if (store.get(proxyStateAtom)?.otherOwner != null) readNewFlows();
  }, POLL_MS);
  // One last read once another owner lets go, for flows it wrote after the last one.
  let hadOtherOwner = store.get(proxyStateAtom)?.otherOwner != null;
  store.sub(proxyStateAtom, () => {
    const hasOtherOwner = store.get(proxyStateAtom)?.otherOwner != null;
    if (hadOtherOwner && !hasOtherOwner) readNewFlows();
    hadOtherOwner = hasOtherOwner;
  });

  load();
}

/** Loads the newest flows again, once `syncFlows` has started */
let reloadFlows: (() => void) | null = null;

/** Empties the list, the search's too, and their counts, as a clear leaves them */
const emptyFlowsAtom = atom(null, (_get, set) => {
  set(flowWindowAtom, emptyWindow);
  set(nonSystemTotalAtom, 0);
  set(searchWindowAtom, (s) => (s == null ? s : { ...s, win: emptyWindow, buffered: [] }));
  set(sortedWindowAtom, (s) =>
    s == null ? s : { ...s, flows: [], boundary: null, cursor: null, buffered: [] },
  );
  set(dropSelectedAtom);
  set(followingAtom, true);
});

/**
 * Clears every flow. The list and its counts empty at once; the database marks them cleared in a
 * moment and deletes them in the background, and its event reloads what came since.
 */
export const clearFlowsAtom = atom(null, async (_get, set) => {
  set(emptyFlowsAtom);
  try {
    await rpc("clear_flows", {});
  } catch (err) {
    // Nothing was cleared: show the flows again.
    reloadFlows?.();
    throw err;
  }
});

/**
 * Keeps `proxyStateAtom` current: on each state change, and polled while the engine is not
 * running here, so another process taking it or letting it go shows.
 */
export function syncProxyState(store: Store) {
  let wasRecording: boolean | null = null;
  store.sub(proxyStateAtom, () => {
    const recording = store.get(proxyStateAtom)?.recording ?? null;
    if (recording === wasRecording) return;
    // Only a pause seen here has a time; one from before launch does not.
    if (recording === false && wasRecording === true) store.set(pausedAtAtom, Date.now());
    if (recording !== false) store.set(pausedAtAtom, null);
    wasRecording = recording;
  });
  function refresh() {
    rpc("get_proxy_state", {})
      .then((state) => store.set(proxyStateAtom, state))
      .catch((err) => console.warn("Failed to read the proxy state", err));
  }
  listen("proxy_state_changed", refresh);
  setInterval(() => {
    if (store.get(proxyStateAtom)?.state !== "running") refresh();
  }, OWNER_POLL_MS);
  refresh();
}

/** Reads the proxy state again, after an action that changes it without an event */
export async function refreshProxyState(store: Store) {
  store.set(proxyStateAtom, await rpc("get_proxy_state", {}));
}
