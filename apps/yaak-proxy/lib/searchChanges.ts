import type { ModelPayload } from "@yaakapp-internal/proxy-lib";
import type { FlowWindow } from "./flowWindow";

/**
 * The changes a search's window `win` takes: flows the backend matched against the search, by
 * its `key`, as it sent their events, and every deletion. A flow the window holds that no longer
 * matches, such as a pending flow that completed under `@is:pending`, leaves it, even when it
 * joined earlier in the same batch. Flows matched against another search, sent as the search
 * changed or read from the database while another process owns the engine, go to `unknown` to
 * be matched again.
 */
export function changesFor(
  key: string,
  win: FlowWindow,
  changes: ModelPayload[],
  unknown: (changes: ModelPayload[]) => void,
): ModelPayload[] {
  const others: ModelPayload[] = [];
  // What the window holds as each change applies
  const held = new Set(win.flows.map((f) => f.id));
  const kept: ModelPayload[] = [];
  for (const c of changes) {
    if (c.change.type === "delete") {
      held.delete(c.model.id);
      kept.push(c);
    } else if (c.search?.key !== key) {
      others.push(c);
    } else if (c.search.matches) {
      held.add(c.model.id);
      kept.push(c);
    } else if (held.delete(c.model.id)) {
      kept.push({ ...c, change: { type: "delete" } });
    }
  }
  if (others.length > 0) unknown(others);
  return kept;
}
