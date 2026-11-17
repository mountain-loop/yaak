import type { Flow } from "@yaakapp-internal/proxy-lib";

/** Where a list's scroll is, as its element reports it */
export interface ScrollPosition {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/** The list is scrolled to its end, or fits its viewport and has no scroll at all */
export function isAtEnd(el: ScrollPosition): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 2;
}

/**
 * A held list follows new traffic again once it is at its end, unless it is sorted: after a
 * scroll there, or after its flows, filter or size change leave it there, as a list that fits its
 * viewport always is. One scrolled up in a list that overflows stays held.
 */
export function resumesFollowing(state: {
  following: boolean;
  sorted: boolean;
  el: ScrollPosition;
}): boolean {
  return !state.following && !state.sorted && isAtEnd(state.el);
}

/**
 * Flows in the list that started after the list was held. `heldAt` is the start of the newest
 * flow across all traffic at that moment, or null when there was none, so it still holds when
 * the sidebar filter changes what the list shows. Expects flows oldest first, like `flowsAtom`.
 */
export function countNewFlows(flows: Pick<Flow, "startedAt">[], heldAt: string | null): number {
  if (heldAt == null) return flows.length;
  let count = 0;
  for (let i = flows.length - 1; i >= 0; i--) {
    const flow = flows[i];
    if (flow == null || flow.startedAt <= heldAt) break;
    count++;
  }
  return count;
}
