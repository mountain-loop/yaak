import type { Flow } from "@yaakapp-internal/proxy-lib";
import type { SplitLayoutLayout } from "@yaakapp-internal/ui";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/** The sidebar's tree, whose selection narrows the list */
export const SIDEBAR_TREE_ID = "proxy-sidebar";

/** The selected flow as last seen, kept once the window has dropped it so the detail stays */
export const selectedFlowAtom = atom<Flow | null>(null);

export const selectedFlowIdAtom = atom((get) => get(selectedFlowAtom)?.id ?? null);

/** The list follows new traffic, rather than being held where it was scrolled or selected */
export const followingAtom = atom(true);

/** When the helper was last registered, so its state is read until approval shows */
export const helperRegisteredAtAtom = atom<number | null>(null);

/** The dialog that walks through allowing the helper in System Settings */
export const helperDialogOpenAtom = atom(false);

/** Stacked by default; the header's toggle switches to side by side */
export const flowLayoutAtom = atomWithStorage<SplitLayoutLayout>("flow_layout", "vertical");
