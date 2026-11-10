import type { Flow } from "@yaakapp-internal/proxy-lib";
import type { ResponseViewMode, SplitLayoutLayout } from "@yaakapp-internal/ui";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { currentPlace, EMPTY_PLACE, type PlaceStack, stackOf, updatePlace } from "./places";

/** The sidebar's tree, whose selection narrows the list */
export const SIDEBAR_TREE_ID = "proxy-sidebar";

/** The selected flow as last seen, kept once the window has dropped it so the detail stays */
export const selectedFlowAtom = atom<Flow | null>(null);

export const selectedFlowIdAtom = atom((get) => get(selectedFlowAtom)?.id ?? null);

/** The places Back and Forward walk, the current one what the window shows */
export const placeStackAtom = atom<PlaceStack>(stackOf(EMPTY_PLACE));

export const placeAtom = atom((get) => currentPlace(get(placeStackAtom)));

/** The filter the list, its counts and the sidebar follow, changed only by applying one */
export const appliedFilterAtom = atom((get) => get(placeAtom).filter);

/** The flows selected at the current place */
export const placeSelectionAtom = atom((get) => get(placeAtom).selection);

/** The tab each half of the card has open at the current place */
export const placeTabsAtom = atom((get) => get(placeAtom).tabs);

export const canGoBackAtom = atom((get) => get(placeStackAtom).index > 0);

export const canGoForwardAtom = atom((get) => {
  const stack = get(placeStackAtom);
  return stack.index < stack.places.length - 1;
});

/**
 * Lets go of flows that are gone, deleted or cleared: the detail empties and the current place
 * no longer selects them, without a place of its own. All of them without `ids`.
 */
export const dropSelectedAtom = atom(null, (get, set, ids?: ReadonlySet<string>) => {
  const selected = get(selectedFlowAtom);
  if (selected != null && (ids == null || ids.has(selected.id))) set(selectedFlowAtom, null);
  set(placeStackAtom, (stack) => {
    const place = currentPlace(stack);
    const kept = [...place.selection].filter((id) => ids != null && !ids.has(id));
    if (kept.length === place.selection.size) return stack;
    const tabs = kept.length === 0 ? {} : place.tabs;
    return updatePlace(stack, { ...place, selection: new Set(kept), tabs });
  });
});

/** A flow to scroll into view once the list has it, as going back to a place asks */
export const revealFlowAtom = atom<{ id: string } | null>(null);

/** The list follows new traffic, rather than being held where it was scrolled or selected */
export const followingAtom = atom(true);

/** When the helper was last registered, so its state is read until approval shows */
export const helperRegisteredAtAtom = atom<number | null>(null);

/** The dialog that walks through allowing the helper in System Settings */
export const helperDialogOpenAtom = atom(false);

/** Stacked by default; the header's toggle switches to side by side */
export const flowLayoutAtom = atomWithStorage<SplitLayoutLayout>("flow_layout", "vertical");

/** Bodies show formatted or raw, one choice for both halves of every flow */
export const bodyViewModeAtom = atomWithStorage<ResponseViewMode>(
  "body_view_mode",
  "pretty",
  undefined,
  { getOnInit: true },
);
