import type { Flow } from "@yaakapp-internal/proxy-lib";
import { selectedIdsFamily } from "@yaakapp-internal/ui";
import { atom, useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import {
  appliedFilterAtom,
  canGoBackAtom,
  canGoForwardAtom,
  placeStackAtom,
  revealFlowAtom,
  SIDEBAR_TREE_ID,
  selectedFlowAtom,
} from "./atoms";
import {
  addPlace,
  currentPlace,
  EMPTY_PLACE,
  type Place,
  type PlaceStack,
  type PlaceTabs,
  sameSelection,
  stackFromJson,
  stackOf,
  stackToJson,
  stackWithout,
  stepPlace,
  updatePlace,
} from "./places";
import { rpc } from "./rpc";
import {
  ALL_ID,
  APPS_ID,
  DOMAINS_ID,
  exclusiveAll,
  itemsById,
  rowsForFilter,
  SAVED_ID,
  selectionText,
} from "./sidebarTree";
import {
  flowsAtom,
  searchWindowAtom,
  sidebarTreeAtom,
  sortedWindowAtom,
  type Store,
} from "./store";
import { command, subscribe } from "./tauri";

/** The search box's text: a draft, which the list follows only once it is applied */
export const searchDraftAtom = atom("");

/** Bumped when the box takes its text from outside, such as Back or the sidebar */
export const searchDraftVersionAtom = atom(0);

/**
 * How going to a place treats the history: a new place, the current one changed in step, or a
 * step back or forward to one there already
 */
export type PlaceMove = "add" | "update" | "back" | "forward";

/** What a move changes; what it leaves out stays as it is */
export interface PlaceChange {
  filter?: string;
  selection?: Iterable<string>;
  /** The tabs to open; left out, they stay with the same selection and reset with a new one */
  tabs?: PlaceTabs;
  /** The selected flow, when the caller has it, so the card shows it without reading it */
  flow?: Flow;
}

/**
 * Goes to a place: the one place the filter, the selection and the card's tabs are set from.
 * Back and Forward step along the history; anything else adds a place or changes the current
 * one, as `move` says. Every argument is plain data, so a request from outside the window, such
 * as a command line's, can arrive as an event and come here. False when there was nowhere to go.
 */
export function goToPlace(store: Store, move: PlaceMove, change: PlaceChange = {}): boolean {
  const stack = store.get(placeStackAtom);
  let next: PlaceStack | null;
  if (move === "back" || move === "forward") {
    next = stepPlace(stack, move === "back" ? -1 : 1);
  } else {
    const before = currentPlace(stack);
    const selection = change.selection == null ? before.selection : new Set(change.selection);
    const place: Place = {
      filter: change.filter ?? before.filter,
      selection,
      tabs: change.tabs ?? (sameSelection(selection, before.selection) ? before.tabs : {}),
    };
    next = move === "add" ? addPlace(stack, place) : updatePlace(stack, place);
  }
  if (next == null) return false;
  store.set(placeStackAtom, next);
  const stepping = move === "back" || move === "forward";
  showPlace(store, currentPlace(next), {
    filter: stepping || change.filter != null,
    reveal: stepping,
    flow: change.flow,
  });
  return true;
}

/**
 * Applies a filter at once, as a new place. `record` keeps it in the filter history, as applying
 * it from the box with Enter, or from the history, does.
 */
export function applyFilter(store: Store, text: string, { record = false } = {}) {
  goToPlace(store, "add", { filter: text });
  if (record && text.trim() !== "") {
    rpc("record_filter", { filter: text }).catch((err) =>
      console.warn("Failed to record the filter", err),
    );
  }
}

/** The box, the card and the list take a place the stack has just moved to */
function showPlace(
  store: Store,
  place: Place,
  opts: { filter: boolean; reveal: boolean; flow?: Flow },
) {
  // The box takes the filter only where it doesn't hold it already, as after Enter, which
  // would otherwise make it anew and lose its focus.
  if (opts.filter && store.get(searchDraftAtom).trim() !== place.filter.trim()) {
    store.set(searchDraftAtom, place.filter);
    store.set(searchDraftVersionAtom, (v) => v + 1);
  }
  const [id] = place.selection;
  if (id == null) {
    store.set(selectedFlowAtom, null);
    return;
  }
  const known = opts.flow?.id === id ? opts.flow : loadedFlow(store, id);
  if (known != null) store.set(selectedFlowAtom, known);
  else readSelected(store, id);
  if (opts.reveal) store.set(revealFlowAtom, { id });
}

/** A flow the window holds already, in any of its lists */
function loadedFlow(store: Store, id: string): Flow | null {
  const selected = store.get(selectedFlowAtom);
  if (selected?.id === id) return selected;
  const lists = [
    store.get(flowsAtom),
    store.get(searchWindowAtom)?.win.flows ?? [],
    store.get(sortedWindowAtom)?.flows ?? [],
  ];
  for (const flows of lists) {
    const found = flows.find((f) => f.id === id);
    if (found != null) return found;
  }
  return null;
}

/**
 * Reads a selected flow the window does not hold, as one gone back to can be. One that no longer
 * exists, cleared or deleted, leaves every place that selects it, with no sign.
 */
function readSelected(store: Store, id: string) {
  store.set(selectedFlowAtom, null);
  rpc("get_flows", { ids: [id] })
    .then(([found]) => {
      if (found == null) {
        store.set(placeStackAtom, (s) => stackWithout(s, new Set([id])));
        return;
      }
      // The window has moved on meanwhile, or shows the flow already, as it was since.
      const current = currentPlace(store.get(placeStackAtom)).selection.has(id);
      if (current && store.get(selectedFlowAtom) == null) store.set(selectedFlowAtom, found);
    })
    .catch((err) => console.warn("Failed to read the selected flow", err));
}

/**
 * Restores where the window was, before the flows load for its filter: its places after a
 * reload, which the engine holds in memory while the app runs, or at launch the last filter
 * applied, which the encrypted database keeps. Filters can hold captured values, so neither is
 * kept in the web view's storage. Keeps them as they change.
 */
export async function syncNavigation(store: Store) {
  const kept = stackFromJson(await rpc("get_window_places", {}).catch(() => null));
  const stack = kept ?? stackOf(EMPTY_PLACE);
  store.set(placeStackAtom, stack);
  showPlace(store, currentPlace(stack), { filter: true, reveal: true });
  if (kept == null) {
    // Unread while traffic is locked, as the database is.
    rpc("get_last_filter", {})
      .then((filter) => {
        // Only over the window as it opened, not where it has been taken since.
        const now = store.get(placeStackAtom);
        if (filter === "" || now.places.length > 1 || currentPlace(now).filter !== "") return;
        goToPlace(store, "update", { filter });
      })
      .catch(() => {});
  }

  // One write at a time, the latest places after it, so they arrive in order.
  let pending: string | null = null;
  let writing = false;
  const write = () => {
    if (writing || pending == null) return;
    const places = pending;
    pending = null;
    writing = true;
    rpc("set_window_places", { places })
      .catch(() => {})
      .finally(() => {
        writing = false;
        write();
      });
  };
  store.sub(placeStackAtom, () => {
    pending = stackToJson(store.get(placeStackAtom));
    write();
  });
  let lastFilter = store.get(appliedFilterAtom);
  store.sub(appliedFilterAtom, () => {
    const filter = store.get(appliedFilterAtom);
    if (filter === lastFilter) return;
    lastFilter = filter;
    rpc("set_last_filter", { filter }).catch(() => {});
  });
}

/** `GO_BACK_EVENT` and `GO_FORWARD_EVENT` in the app's `window_menu.rs` */
const MENU_GO_BACK_EVENT = "menu_go_back";
const MENU_GO_FORWARD_EVENT = "menu_go_forward";

/** The mouse's back and forward buttons */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

/**
 * Back and Forward from ⌘[ and ⌘], the mouse's side buttons and the app menu's Go items, which
 * are enabled while there is somewhere to go
 */
export function useNavigationControls() {
  const store = useStore();
  const canGoBack = useAtomValue(canGoBackAtom);
  const canGoForward = useAtomValue(canGoForwardAtom);

  useEffect(() => {
    command("set_go_menu", { back: canGoBack, forward: canGoForward }).catch(() => {});
  }, [canGoBack, canGoForward]);

  useEffect(() => {
    // Before the editors, whose ⌘[ and ⌘] would indent the search box.
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key !== "[" && e.key !== "]") return;
      e.preventDefault();
      e.stopPropagation();
      goToPlace(store, e.key === "[" ? "back" : "forward");
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button !== MOUSE_BACK && e.button !== MOUSE_FORWARD) return;
      e.preventDefault();
      if (e.type === "mouseup") goToPlace(store, e.button === MOUSE_BACK ? "back" : "forward");
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onMouse);
    window.addEventListener("mouseup", onMouse);
    const offBack = subscribe<null>(MENU_GO_BACK_EVENT, () => goToPlace(store, "back"));
    const offForward = subscribe<null>(MENU_GO_FORWARD_EVENT, () => goToPlace(store, "forward"));
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("mouseup", onMouse);
      offBack();
      offForward();
    };
  }, [store]);
}

/** When the person last clicked or pressed a key in the sidebar */
let lastSidebarInput = 0;

/** How soon after a click or key a change of the sidebar's selection counts as theirs */
const SIDEBAR_INPUT_MS = 500;

/** Notes a click or key in the sidebar, so the selection change it makes applies its filter */
export function noteSidebarInput() {
  lastSidebarInput = Date.now();
}

/**
 * Notes a press that opens a row's menu, which selects the row without applying its filter, so
 * the menu's items add to the filter as it is
 */
export function noteSidebarMenu() {
  lastSidebarInput = 0;
}

/**
 * Keeps the sidebar's selection and the filter in step. Selecting rows applies their query at
 * once, as a new place; a filter applied keeps a row selected while its query is still one of
 * the filter's terms, and All traffic selected while there is none.
 */
export function syncSidebarSelection(store: Store) {
  const selectedAtom = selectedIdsFamily(SIDEBAR_TREE_ID);
  let syncing = false;

  function select(next: string[]) {
    const ids = store.get(selectedAtom);
    if (next.length === ids.length && next.every((id, i) => id === ids[i])) return;
    syncing = true;
    store.set(selectedAtom, next);
    syncing = false;
  }

  // `add`: rows whose query is a whole group of the filter join, as when Back returns to a
  // filter the rows wrote; otherwise only those selected are kept or dropped.
  function keepRows(add: boolean) {
    if (syncing) return;
    const items = itemsById(store.get(sidebarTreeAtom));
    const next = rowsForFilter(store.get(appliedFilterAtom), store.get(selectedAtom), items, add);
    select(next);
  }

  // The tree writes its selection again as it renders, the same rows in a new array, or its last
  // row when the selection was emptied; only a change of rows right after a click or a key in
  // the sidebar is the person selecting. A click on a row the tree selected again by itself, as
  // after its menu was opened, applies it then.
  let lastRows = store.get(selectedAtom);
  store.sub(selectedAtom, () => {
    const before = lastRows;
    const ids = store.get(selectedAtom);
    const theirs = Date.now() - lastSidebarInput <= SIDEBAR_INPUT_MS;
    if (ids.join("\n") === before.join("\n") && !theirs) return;
    lastRows = ids;
    if (syncing) return;
    // Not the person's, such as the tree selecting its first row as it mounts over a filter
    // restored at launch, or a row as its menu opens: the rows go back to what the filter says.
    if (!theirs) {
      keepRows(false);
      return;
    }
    const exclusive = exclusiveAll(ids, before);
    if (exclusive !== ids) select(exclusive);
    // Group headings are not filters.
    const rows = exclusive.filter((id) => id !== APPS_ID && id !== DOMAINS_ID && id !== SAVED_ID);
    if (rows.length === 0) return;
    const items = itemsById(store.get(sidebarTreeAtom));
    const selected = rows.flatMap((id) => {
      const item = items.get(id);
      // A heading has no query to apply; System's has its own.
      return item == null || (item.query === "" && item.kind !== "all") ? [] : [item];
    });
    if (selected.length === 0) return;
    const text = selectionText(selected);
    if (text === store.get(appliedFilterAtom)) return;
    syncing = true;
    applyFilter(store, text);
    syncing = false;
  });
  store.sub(appliedFilterAtom, () => keepRows(true));

  // A filter restored at launch selects no row; none at all is All traffic.
  if (store.get(selectedAtom).length === 0 && store.get(appliedFilterAtom).trim() === "") {
    store.set(selectedAtom, [ALL_ID]);
  }
}
