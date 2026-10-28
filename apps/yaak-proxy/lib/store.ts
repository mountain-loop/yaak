import type { ModelPayload } from "@yaakapp-internal/proxy-lib";
import { atom, type createStore } from "jotai";
import { followingAtom, selectedFlowAtom } from "./atoms";
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

/** How long new flows gather before they reach the list, so a burst renders once */
const FLUSH_MS = 100;

/** The flows in memory: a window onto the database, which keeps them all */
export const flowWindowAtom = atom<FlowWindow>(emptyWindow);

/** Oldest first, so new traffic arrives at the end of the list */
export const flowsAtom = atom((get) => get(flowWindowAtom).flows);

/** Start of the newest flow held, across all traffic */
export const newestStartedAtAtom = atom((get) => get(flowsAtom).at(-1)?.startedAt ?? null);

/** Start and id of the oldest flow held, which loading older flows moves back */
export const oldestFlowAtom = atom((get) => get(flowsAtom)[0] ?? null);

export const hasOlderFlowsAtom = atom((get) => get(flowWindowAtom).hasOlder);

/** Flows in the database */
export const flowTotalAtom = atom((get) => get(flowWindowAtom).total);

/** Follows new traffic, dropping the older flows scrolling up loaded, or holds the list */
export const followAtom = atom(
  (get) => get(followingAtom),
  (_get, set, following: boolean) => {
    set(followingAtom, following);
    if (following) set(flowWindowAtom, (win) => trimWindow(win));
  },
);

let loadingOlder = false;

/** Loads the page of flows before the oldest one held */
export const loadOlderFlowsAtom = atom(null, async (get, set) => {
  const { flows, hasOlder } = get(flowWindowAtom);
  const first = flows[0];
  if (loadingOlder || !hasOlder || first == null) return;
  loadingOlder = true;
  try {
    const res = await rpc("list_flows", { before: first.id, limit: PAGE_SIZE });
    // Dropped when the window moved on meanwhile, trimmed or cleared.
    set(flowWindowAtom, (win) =>
      win.flows[0]?.id === first.id ? prependOlder(win, res.flows, PAGE_SIZE) : win,
    );
  } catch (err) {
    console.warn("Failed to load older flows", err);
  } finally {
    loadingOlder = false;
  }
});

/**
 * Loads the newest flows, then keeps them current with the engine's events. Events gather for
 * `FLUSH_MS` and apply together, and the window drops its oldest flows while the list follows,
 * so a new flow costs the same however many the database holds.
 */
export function syncFlows(store: ReturnType<typeof createStore>) {
  let pending: ModelPayload[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loaded = false;

  function flush() {
    timer = null;
    if (!loaded || pending.length === 0) return;
    const changes = pending;
    pending = [];
    store.set(flowWindowAtom, (win) => {
      const next = applyChanges(win, changes);
      return store.get(followingAtom) ? trimWindow(next) : next;
    });
    const selected = store.get(selectedFlowAtom);
    const change = changes.findLast((c) => c.model.id === selected?.id);
    if (change != null) {
      store.set(selectedFlowAtom, change.change.type === "delete" ? null : change.model);
    }
  }

  listen("model_write", (payload) => {
    pending.push(payload);
    if (timer == null) timer = setTimeout(flush, FLUSH_MS);
  });

  // Loads again rather than only emptying, for a flow written between the delete and the event.
  listen("flows_cleared", () => {
    pending = [];
    store.set(flowWindowAtom, emptyWindow);
    store.set(selectedFlowAtom, null);
    store.set(followingAtom, true);
    load();
  });

  let loads = 0;
  function load() {
    loaded = false;
    const thisLoad = ++loads;
    void rpc("list_flows", { limit: WINDOW_SIZE }).then((res) => {
      // A clear since asked for a newer page.
      if (thisLoad !== loads) return;
      store.set(flowWindowAtom, windowFromPage(res.flows, WINDOW_SIZE, res.total));
      loaded = true;
      flush();
    });
  }

  load();
}
