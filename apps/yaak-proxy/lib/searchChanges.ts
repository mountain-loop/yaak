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

/** Flows whose newest event `FlowEvents` remembers, at most */
const REMEMBERED = 20_000;

/**
 * The order flow events arrived in, so an answer that comes later than newer events for the
 * same flow can be told apart: a re-check started before the search changed, say, whose flow a
 * newer event has since updated or removed, even from the window.
 */
export class FlowEvents {
  private count = 0;
  /** Each event's place, by the payload as it arrived */
  private seqs = new WeakMap<ModelPayload, number>();
  /** The newest event's place, by flow, removals included, the least recent first */
  private latest = new Map<string, number>();
  /** Places at or below this may have newer events no longer remembered */
  private floor = 0;

  constructor(private readonly remembered = REMEMBERED) {}

  /** Notes events as they arrive */
  arrived(changes: ModelPayload[]) {
    for (const c of changes) {
      this.count++;
      this.seqs.set(c, this.count);
      this.note(c.model.id);
    }
  }

  /** Notes flows removed with no event of their own, as the keep-traffic sweep removes them */
  removed(ids: string[]) {
    for (const id of ids) {
      this.count++;
      this.note(id);
    }
  }

  private note(id: string) {
    // Moved to the end, so the least recent go first
    this.latest.delete(id);
    this.latest.set(id, this.count);
    for (const [oldest, seq] of this.latest) {
      if (this.latest.size <= this.remembered) break;
      this.latest.delete(oldest);
      this.floor = Math.max(this.floor, seq);
    }
  }

  /**
   * Of the changes a late answer is for, those no newer event for their flow has passed. One
   * from before the oldest event remembered is dropped, as it can't be judged; the next count
   * and reload correct the list. One whose arrival was not noted is kept.
   */
  current<T extends ModelPayload>(changes: T[]): T[] {
    return changes.filter((c) => {
      const seq = this.seqs.get(c);
      if (seq == null) return true;
      const newest = this.latest.get(c.model.id);
      return newest == null ? seq > this.floor : seq >= newest;
    });
  }

  /** Forgets everything, as a clear does */
  reset() {
    this.latest.clear();
    this.floor = this.count;
  }
}
