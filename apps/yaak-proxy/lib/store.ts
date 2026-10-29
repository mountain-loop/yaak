import type { GetProxyStateResponse, ModelPayload } from "@yaakapp-internal/proxy-lib";
import { selectedIdsFamily } from "@yaakapp-internal/ui";
import { atom, type createStore } from "jotai";
import { followingAtom, SIDEBAR_TREE_ID, selectedFlowAtom } from "./atoms";
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
import { type FlowQuery, matchesQuery, selectionQuery } from "./search";

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
 * The database has no flows and nothing narrows the list, so the first-run card shows. A boolean
 * of its own, so new traffic does not re-render what reads it.
 */
export const showFirstRunAtom = atom(
  (get) => get(flowsLoadedAtom) && get(flowTotalAtom) === 0 && get(activeQueryAtom) == null,
);

/** Some flow held names the app that sent it, which only some platforms can tell */
export const hasAppsAtom = atom((get) => get(flowsAtom).some((f) => f.clientName != null));

/** The search box's terms, once typing settles, or null */
export const searchTermsAtom = atom<string | null>(null);

/** The search the list shows, from the search box and the sidebar, or null for all traffic */
export const activeQueryAtom = atom<FlowQuery | null>((get) => {
  const q = get(searchTermsAtom);
  const selection = selectionQuery(get(selectedIdsFamily(SIDEBAR_TREE_ID)));
  if (q == null && selection == null) return null;
  return { ...(q == null ? {} : { q }), ...selection };
});

/** A window onto the flows a search covers, loaded from the database as the main one is */
export interface SearchWindow {
  key: string;
  query: FlowQuery;
  win: FlowWindow;
  /** The first page has not arrived yet */
  loading: boolean;
}

export const searchWindowAtom = atom<SearchWindow | null>(null);

/** The window the list shows: the search's, or all traffic's */
const shownWindowAtom = atom((get) => get(searchWindowAtom)?.win ?? get(flowWindowAtom));

/** The flows the list shows, oldest first */
export const shownFlowsAtom = atom((get) => get(shownWindowAtom).flows);

/** Flows in the database the list covers: every one, or those the search matches */
export const shownTotalAtom = atom((get) => get(shownWindowAtom).total);

/** Start and id of the oldest flow shown, which loading older flows moves back */
export const oldestFlowAtom = atom((get) => get(shownFlowsAtom)[0] ?? null);

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
      if (s == null || s.loading) return s;
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

  // Loads again rather than only emptying, for a flow written between the delete and the event.
  listen("flows_cleared", () => {
    pending = [];
    store.set(flowWindowAtom, emptyWindow);
    store.set(selectedFlowAtom, null);
    store.set(followingAtom, true);
    load();
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
      flush();
    });
    loadSearch(store.get(activeQueryAtom));
  }

  /** Loads the first page of `query`'s flows into a window of its own, or drops it for null */
  function loadSearch(query: FlowQuery | null) {
    if (query == null) {
      store.set(searchWindowAtom, null);
      return;
    }
    const key = JSON.stringify(query);
    store.set(searchWindowAtom, { key, query, win: emptyWindow, loading: true });
    void rpc("list_flows", { ...query, limit: WINDOW_SIZE })
      .then((res) => {
        const win = windowFromPage(res.flows, WINDOW_SIZE, res.matching ?? res.total);
        // Flows that arrived while it loaded are in the page or come with the next flush.
        store.set(searchWindowAtom, (s) => (s?.key === key ? { ...s, win, loading: false } : s));
      })
      .catch((err) => {
        console.warn("Failed to search flows", err);
        store.set(searchWindowAtom, (s) => (s?.key === key ? { ...s, loading: false } : s));
      });
  }

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
  setInterval(() => {
    if (polling || !loaded || store.get(proxyStateAtom)?.otherOwner == null) return;
    polling = true;
    const after = seenId;
    const read =
      after == null
        ? rpc("list_flows", { limit: WINDOW_SIZE })
        : rpc("list_flows", { after, limit: WINDOW_SIZE });
    read
      .then((res) => {
        if (res.flows.length === 0) return;
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
  }, POLL_MS);

  load();
}

/** Keeps `proxyStateAtom` current: on each state change, and polled while another owner has it */
export function syncProxyState(store: Store) {
  function refresh() {
    rpc("get_proxy_state", {})
      .then((state) => store.set(proxyStateAtom, state))
      .catch((err) => console.warn("Failed to read the proxy state", err));
  }
  listen("proxy_state_changed", refresh);
  setInterval(() => {
    if (store.get(proxyStateAtom)?.otherOwner != null) refresh();
  }, OWNER_POLL_MS);
  refresh();
}

/** Reads the proxy state again, after an action that changes it without an event */
export async function refreshProxyState(store: Store) {
  store.set(proxyStateAtom, await rpc("get_proxy_state", {}));
}
