import type { Flow, GetProxyStateResponse, ModelPayload } from "@yaakapp-internal/proxy-lib";
import { selectedIdsFamily } from "@yaakapp-internal/ui";
import { atom, type createStore } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { followingAtom, SIDEBAR_TREE_ID, selectedFlowAtom } from "./atoms";
import {
  type ColumnPrefs,
  defaultColumnPrefs,
  type FlowSort,
  parseColumnPrefs,
  sortFlows,
} from "./columns";
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
import { listen, rpc } from "./rpc";
import { type FlowQuery, matchesQuery, parseSearch } from "./search";
import {
  ALL_ID,
  APPS_ID,
  buildSidebarTree,
  DOMAINS_ID,
  itemsById,
  queryInText,
  selectionText,
} from "./sidebarTree";

type Store = ReturnType<typeof createStore>;

/** How long new flows gather before they reach the list, so a burst renders once */
const FLUSH_MS = 100;
/** How long after new flows the total is counted again from the database */
const RECOUNT_MS = 1000;
/** How often the database is read for new flows while another process owns the engine */
const POLL_MS = 1000;
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
  (get) => get(flowsLoadedAtom) && get(flowTotalAtom) === 0 && get(searchTextAtom).trim() === "",
);

/** The system proxy has been on at some point since this install, which first run waits for */
export const systemProxyEverOnAtom = atomWithStorage("system_proxy_ever_on", false, undefined, {
  getOnInit: true,
});

/** Some flow held names the app that sent it, which only some platforms can tell */
export const hasAppsAtom = atom((get) => get(flowsAtom).some((f) => f.clientName != null));

/** The search box's text as typed, which the sidebar's selection writes too */
export const searchTextAtom = atom("");

/** Bumped when the text changes from outside the box, such as the sidebar, so the box takes it */
export const searchTextVersionAtom = atom(0);

/** The search box's text once typing settles */
export const searchTermsAtom = atom("");

/** System's flows are left out of All traffic, by the eye on System's row */
export const hideSystemAtom = atomWithStorage("sidebar_hide_system", false, undefined, {
  getOnInit: true,
});

/** The search the list shows, from the search box's settled text, or null for all traffic */
export const activeQueryAtom = atom<FlowQuery | null>((get) =>
  parseSearch(get(searchTermsAtom), get(hideSystemAtom)),
);

/** Writes `text` into the search box at once, as the sidebar does, without waiting for typing */
export const setSearchTextAtom = atom(null, (_get, set, text: string) => {
  set(searchTextAtom, text);
  set(searchTermsAtom, text);
  set(searchTextVersionAtom, (v) => v + 1);
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
  buildSidebarTree(get(sidebarFlowsAtom), get(allTrafficTotalAtom)),
);

const storedColumnPrefsAtom = atomWithStorage<unknown>(
  "flow_columns",
  defaultColumnPrefs,
  undefined,
  {
    getOnInit: true,
  },
);

/** Which columns the list shows and how wide, as the person left them */
export const columnPrefsAtom = atom(
  (get) => parseColumnPrefs(get(storedColumnPrefsAtom)),
  (get, set, update: ColumnPrefs | ((prev: ColumnPrefs) => ColumnPrefs)) => {
    const prev = parseColumnPrefs(get(storedColumnPrefsAtom));
    set(storedColumnPrefsAtom, typeof update === "function" ? update(prev) : update);
  },
);

/** The list's sort, or null for start time, the order flows arrive in */
export const flowSortAtom = atom<FlowSort | null>(null);

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

/** The flows the list shows: oldest first, or in the sort's order, over those loaded */
export const shownFlowsAtom = atom((get) => sortFlows(get(windowFlowsAtom), get(flowSortAtom)));

/** Flows in the database the list covers: every one, or those the search matches */
export const shownTotalAtom = atom((get) => get(shownWindowAtom).total);

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

/** Loads the page of flows before the oldest one shown, from the search's flows when searching */
export const loadOlderFlowsAtom = atom(null, async (get, set) => {
  const search = get(searchWindowAtom);
  const { flows, hasOlder } = search?.win ?? get(flowWindowAtom);
  const first = flows[0];
  if (changesDuringPage != null || !hasOlder || first == null) return;
  const changes: ModelPayload[] = [];
  changesDuringPage = changes;
  try {
    const res = await rpc("list_flows", { ...search?.query, before: first.id, limit: PAGE_SIZE });
    // Dropped when the window moved on meanwhile, trimmed, cleared or searched again.
    const merge = (win: FlowWindow) => {
      if (win.flows[0]?.id !== first.id) return win;
      const merged = prependOlder(win, res.flows, PAGE_SIZE);
      const kept = search == null ? changes : changesFor(search.query, changes);
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
  }
});

/** The changes a search's window takes: flows it matches, and every deletion */
function changesFor(query: FlowQuery, changes: ModelPayload[]): ModelPayload[] {
  return changes.filter((c) => c.change.type === "delete" || matchesQuery(c.model, query));
}

/**
 * Loads the newest flows, then keeps them current with the engine's events, or with reads of the
 * database while another process owns the engine. Events gather for `FLUSH_MS` and apply
 * together, and the window drops its oldest flows while the list follows, so a new flow costs the
 * same however many the database holds. A search gets a window of its own, kept current the same
 * way.
 */
export function syncFlows(store: Store) {
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
      const next = applyChanges(s.win, changesFor(s.query, changes));
      return { ...s, win: following ? trimWindow(next) : next };
    });
    const selected = store.get(selectedFlowAtom);
    const change = changes.findLast((c) => c.model.id === selected?.id);
    if (change != null) {
      store.set(selectedFlowAtom, change.change.type === "delete" ? null : change.model);
    }
    if (recountTimer == null) recountTimer = setTimeout(recount, RECOUNT_MS);
  }

  function receive(changes: ModelPayload[]) {
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
      void rpc("list_flows", { system: false, limit: 0 }).then((res) => {
        if (thisLoad === loads) store.set(nonSystemTotalAtom, res.matching ?? res.total);
      });
    }
    const search = store.get(searchWindowAtom);
    if (search == null || search.loading) return;
    void rpc("list_flows", { ...search.query, limit: 0 }).then((res) => {
      const total = res.matching ?? res.total;
      store.set(searchWindowAtom, (s) =>
        s?.key !== search.key || s.win.total === total ? s : { ...s, win: { ...s.win, total } },
      );
    });
  }

  listen("model_write", (payload) => {
    seenId = payload.model.id;
    receive([payload]);
  });

  // Loads again rather than only emptying, for a flow written between the clear and the event.
  listen("flows_cleared", () => {
    store.set(emptyFlowsAtom);
    pending = [];
    load();
  });

  // The oldest flows, swept to keep the capture under its size limit: dropped wherever they
  // are held, and the totals counted again from the database.
  listen("flows_removed", ({ ids }) => {
    const removed = new Set(ids);
    const drop = (win: FlowWindow) =>
      win.flows.some((f) => removed.has(f.id))
        ? { ...win, flows: win.flows.filter((f) => !removed.has(f.id)) }
        : win;
    pending = pending.filter((p) => !removed.has(p.model.id));
    store.set(flowWindowAtom, drop);
    store.set(searchWindowAtom, (s) => (s == null ? s : { ...s, win: drop(s.win) }));
    if (removed.has(store.get(selectedFlowAtom)?.id ?? "")) store.set(selectedFlowAtom, null);
    if (recountTimer == null) recountTimer = setTimeout(recount, RECOUNT_MS);
  });

  function load() {
    loaded = false;
    const thisLoad = ++loads;
    void rpc("list_flows", { limit: WINDOW_SIZE }).then((res) => {
      // A clear since asked for a newer page.
      if (thisLoad !== loads) return;
      store.set(flowWindowAtom, windowFromPage(res.flows, WINDOW_SIZE, res.total));
      seenId = res.flows[0]?.id ?? null;
      loaded = true;
      store.set(flowsLoadedAtom, true);
      // Flows recorded before this install remembered it mean setup was done.
      if (res.total > 0) store.set(systemProxyEverOnAtom, true);
      flush();
      recount();
    });
    loadSearch(store.get(activeQueryAtom));
  }
  reloadFlows = load;

  /** Loads the first page of `query`'s flows into a window of its own, or drops it for null */
  function loadSearch(query: FlowQuery | null) {
    if (query == null) {
      store.set(searchWindowAtom, null);
      return;
    }
    // Unique to this load, so a slower answer to an earlier one with the same query, such as
    // one read before a clear, is dropped.
    const key = `${++searchLoads}:${JSON.stringify(query)}`;
    store.set(searchWindowAtom, { key, query, win: emptyWindow, loading: true, buffered: [] });
    const settle = (page: FlowWindow | null) =>
      store.set(searchWindowAtom, (s) => {
        if (s?.key !== key) return s;
        // Applied again over the page: a flow already in it is replaced, not added.
        const win = applyChanges(page ?? s.win, changesFor(query, s.buffered));
        return {
          ...s,
          win: page == null ? win : { ...win, total: page.total },
          loading: false,
          buffered: [],
        };
      });
    void rpc("list_flows", { ...query, limit: WINDOW_SIZE })
      .then((res) => settle(windowFromPage(res.flows, WINDOW_SIZE, res.matching ?? res.total)))
      .catch((err) => {
        console.warn("Failed to search flows", err);
        settle(null);
      });
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

  // All traffic's count leaves System out while it is hidden.
  store.sub(hideSystemAtom, () => {
    if (loaded) recount();
  });

  let activeKey = JSON.stringify(store.get(activeQueryAtom));
  store.sub(activeQueryAtom, () => {
    const query = store.get(activeQueryAtom);
    const key = JSON.stringify(query);
    if (key === activeKey) return;
    activeKey = key;
    loadSearch(query);
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
  set(selectedFlowAtom, null);
  set(followingAtom, true);
  set(flowSortAtom, null);
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

/** When the person last clicked or pressed a key in the sidebar */
let lastSidebarInput = 0;

/** How soon after a click or key a change of the sidebar's selection counts as theirs */
const SIDEBAR_INPUT_MS = 500;

/** Notes a click or key in the sidebar, so the selection change it makes writes the search */
export function noteSidebarInput() {
  lastSidebarInput = Date.now();
}

/**
 * Keeps the sidebar's selection and the search box in step. Selecting rows writes their query
 * into the box; typing keeps a row selected while its query is still one of the box's terms,
 * and All traffic selected while the box is empty.
 */
export function syncSidebarSelection(store: Store) {
  const selectedAtom = selectedIdsFamily(SIDEBAR_TREE_ID);
  let syncing = false;

  // The tree writes its selection again as it renders, the same rows in a new array, or its last
  // row when the selection was emptied; only a change of rows right after a click or a key in
  // the sidebar is the person selecting.
  let lastRows = store.get(selectedAtom).join("\n");
  store.sub(selectedAtom, () => {
    const ids = store.get(selectedAtom);
    const key = ids.join("\n");
    if (key === lastRows) return;
    lastRows = key;
    if (syncing || Date.now() - lastSidebarInput > SIDEBAR_INPUT_MS) return;
    // Group headings are not filters.
    const rows = ids.filter((id) => id !== APPS_ID && id !== DOMAINS_ID);
    if (rows.length === 0) return;
    const items = itemsById(store.get(sidebarTreeAtom));
    const selected = rows.flatMap((id) => {
      const item = items.get(id);
      return item == null ? [] : [item];
    });
    if (selected.length === 0) return;
    const text = selectionText(selected);
    if (text === store.get(searchTextAtom)) return;
    syncing = true;
    store.set(setSearchTextAtom, text);
    syncing = false;
  });

  store.sub(searchTextAtom, () => {
    if (syncing) return;
    const text = store.get(searchTextAtom);
    const items = itemsById(store.get(sidebarTreeAtom));
    const ids = store.get(selectedAtom);
    const kept = ids.filter((id) => {
      const item = items.get(id);
      return item != null && item.query !== "" && queryInText(item.query, text);
    });
    const next = text.trim() === "" ? [ALL_ID] : kept;
    if (next.length === ids.length && next.every((id, i) => id === ids[i])) return;
    syncing = true;
    store.set(selectedAtom, next);
    syncing = false;
  });

  if (store.get(selectedAtom).length === 0) store.set(selectedAtom, [ALL_ID]);
}

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
