import type { SplitLayoutLayout } from "@yaakapp-internal/ui";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const selectedFlowIdAtom = atom<string | null>(null);

/** Stacked by default; the header's toggle switches to side by side */
export const flowLayoutAtom = atomWithStorage<SplitLayoutLayout>("flow_layout", "vertical");
