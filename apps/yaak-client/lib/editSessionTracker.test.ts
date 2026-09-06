import type { ModelVersionReason } from "@yaakapp-internal/models";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EditSessionTracker } from "./editSessionTracker";

type Capture = [requestId: string, reason: ModelVersionReason];

function tracker(idleMs = 1000) {
  const captured: Capture[] = [];
  return {
    captured,
    tracker: new EditSessionTracker((id, reason) => captured.push([id, reason]), idleMs),
  };
}

describe("EditSessionTracker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("captures a request once it has been left alone", () => {
    const { tracker: t, captured } = tracker();
    t.noteEdit("rq_1");

    vi.advanceTimersByTime(999);
    expect(captured).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(captured).toEqual([["rq_1", "idle"]]);
  });

  test("a burst of edits is one capture, not one per keystroke", () => {
    const { tracker: t, captured } = tracker();
    for (let i = 0; i < 10; i++) {
      t.noteEdit("rq_1");
      vi.advanceTimersByTime(500);
    }
    expect(captured).toEqual([]);

    vi.advanceTimersByTime(1000);
    expect(captured).toEqual([["rq_1", "idle"]]);
  });

  test("captures the request being left, not the one being opened", () => {
    const { tracker: t, captured } = tracker();
    t.noteActiveRequest("rq_1");
    expect(captured).toEqual([]);

    t.noteActiveRequest("rq_2");
    expect(captured).toEqual([["rq_1", "switch"]]);
  });

  test("re-selecting the same request is not a boundary", () => {
    const { tracker: t, captured } = tracker();
    t.noteActiveRequest("rq_1");
    t.noteActiveRequest("rq_1");
    expect(captured).toEqual([]);
  });

  test("blur and close capture the request still on screen", () => {
    const { tracker: t, captured } = tracker();
    t.noteActiveRequest("rq_1");
    t.noteBoundary();
    t.noteBoundary();
    expect(captured).toEqual([
      ["rq_1", "switch"],
      ["rq_1", "switch"],
    ]);
  });

  test("nothing is captured before a request is open", () => {
    const { tracker: t, captured } = tracker();
    t.noteBoundary();
    t.noteActiveRequest(null);
    expect(captured).toEqual([]);
  });
});
