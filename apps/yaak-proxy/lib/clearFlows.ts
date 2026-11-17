import { atomWithStorage, createJSONStorage } from "jotai/utils";

/**
 * Clearing traffic asks first, until "Don't ask again" is checked in its dialog. The switch in
 * Settings turns the asking back on.
 */
export const confirmClearFlowsAtom = atomWithStorage<boolean>(
  "confirm_clear_flows",
  true,
  // Read through globalThis so tests, which have no localStorage, can import this
  createJSONStorage<boolean>(() => globalThis.localStorage),
  { getOnInit: true },
);

/** What Clear does now: nothing, ask first, or clear at once */
export type ClearFlowsAction = "disabled" | "confirm" | "clear";

export function clearFlowsAction({
  total,
  locked,
  confirm,
}: {
  /** Flows there are to clear */
  total: number;
  /** Captured traffic is locked, so none of it can be read */
  locked: boolean;
  /** The saved preference to ask before clearing */
  confirm: boolean;
}): ClearFlowsAction {
  if (locked || total === 0) return "disabled";
  return confirm ? "confirm" : "clear";
}
