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
 * costs one query and creates nothing — which is what lets this stay a few
 * timers instead of a change-tracking system.
 */
export class EditSessionTracker {
  /**
   * One idle countdown per request. Writes arrive for any request — from other
   * windows and sync too — and an edit to one must never restart or cancel
   * another's countdown.
   */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private activeRequestId: string | null = null;

  constructor(
    private readonly snapshot: Snapshot,
    private readonly idleMs: number = IDLE_MS,
  ) {}

  /** A request was written. Restarts that request's idle countdown. */
  noteEdit(requestId: string) {
    this.clearTimer(requestId);
    this.timers.set(
      requestId,
      setTimeout(() => {
        this.timers.delete(requestId);
        this.snapshot(requestId, "idle");
      }, this.idleMs),
    );
  }

  /** The user moved to a different request, so the one they left is finished. */
  noteActiveRequest(requestId: string | null) {
    if (requestId === this.activeRequestId) return;
    const left = this.activeRequestId;
    this.activeRequestId = requestId;
    if (left != null) this.capture(left, this.snapshot);
  }

  /**
   * The window lost focus or is closing. A close can't wait for anything, so it
   * passes its own snapshot function.
   */
  noteBoundary(snapshot: Snapshot = this.snapshot) {
    if (this.activeRequestId != null) this.capture(this.activeRequestId, snapshot);
  }

  /** Capture at a boundary, which also settles any idle countdown still pending */
  private capture(requestId: string, snapshot: Snapshot) {
    this.clearTimer(requestId);
    snapshot(requestId, "switch");
  }

  private clearTimer(requestId: string) {
    const timer = this.timers.get(requestId);
    if (timer == null) return;
    clearTimeout(timer);
    this.timers.delete(requestId);
  }
}
