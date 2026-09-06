import type { ModelVersionReason } from "@yaakapp-internal/models";

/**
 * How long a request has to sit untouched before its edits become a version.
 * Long enough that typing a URL is one version rather than forty, short enough
 * that walking away from a half-finished edit still records it.
 */
export const IDLE_MS = 60_000;

type Snapshot = (requestId: string, reason: ModelVersionReason) => void;

/**
 * When a request's editing session ends.
 *
 * The backend versions a request on every send, which covers "what produced
 * this response". This covers the rest: an edit someone made and then walked
 * away from, which no send would ever have captured.
 *
 * It deliberately knows nothing about *what* changed. Versions are
 * content-addressed, so a boundary that turns out to have nothing behind it
 * costs one query and creates nothing — which is what lets this stay a timer
 * and two assignments instead of a change-tracking system.
 */
export class EditSessionTracker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idleRequestId: string | null = null;
  private activeRequestId: string | null = null;

  constructor(
    private readonly snapshot: Snapshot,
    private readonly idleMs: number = IDLE_MS,
  ) {}

  /** A request was written. Restarts its idle countdown. */
  noteEdit(requestId: string) {
    if (this.timer != null) clearTimeout(this.timer);
    this.idleRequestId = requestId;
    this.timer = setTimeout(() => {
      this.timer = null;
      const requestId = this.idleRequestId;
      if (requestId != null) this.snapshot(requestId, "idle");
    }, this.idleMs);
  }

  /** The user moved to a different request, so the one they left is finished. */
  noteActiveRequest(requestId: string | null) {
    if (requestId === this.activeRequestId) return;
    const left = this.activeRequestId;
    this.activeRequestId = requestId;
    if (left != null) this.snapshot(left, "switch");
  }

  /** The window lost focus or is closing. */
  noteBoundary() {
    if (this.activeRequestId != null) this.snapshot(this.activeRequestId, "switch");
  }
}
