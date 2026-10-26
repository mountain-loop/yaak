import type { Flow } from "@yaakapp-internal/proxy-lib";

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
