import type { Flow, ModelPayload } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import {
  applyChanges,
  emptyWindow,
  type FlowWindow,
  prependOlder,
  trimWindow,
  windowFromPage,
} from "./flowWindow";

/** A flow started at `second` past 10:00, with an id that sorts the same way */
function flow(second: number, extra: Partial<Flow> = {}): Flow {
  const s = String(second).padStart(2, "0");
  return { id: `fl_${s}`, startedAt: `2026-10-28T10:00:${s}`, ...extra } as Flow;
}

const created = (f: Flow): ModelPayload => ({
  model: f,
  change: { type: "upsert", created: true },
});
const updated = (f: Flow): ModelPayload => ({
  model: f,
  change: { type: "upsert", created: false },
});
const ids = (win: FlowWindow) => win.flows.map((f) => f.id);

describe("windowFromPage", () => {
  test("holds the newest page oldest first", () => {
    const win = windowFromPage([flow(3), flow(2), flow(1)], 3, 10);
    expect(ids(win)).toEqual(["fl_01", "fl_02", "fl_03"]);
    expect(win).toMatchObject({ hasOlder: true, total: 10 });
  });

  test("knows there is nothing older when the page came back short", () => {
    expect(windowFromPage([flow(1)], 3, 1).hasOlder).toBe(false);
  });
});

describe("applyChanges", () => {
  test("appends new traffic and counts it", () => {
    const win = applyChanges(windowFromPage([flow(2), flow(1)], 10, 2), [
      created(flow(3)),
      created(flow(4)),
    ]);
    expect(ids(win)).toEqual(["fl_01", "fl_02", "fl_03", "fl_04"]);
    expect(win.total).toBe(4);
  });

  test("puts a slow flow where it started", () => {
    const win = applyChanges(windowFromPage([flow(5), flow(1)], 10, 2), [created(flow(3))]);
    expect(ids(win)).toEqual(["fl_01", "fl_03", "fl_05"]);
  });

  test("orders flows that started together by id", () => {
    const a = flow(2, { id: "fl_a" });
    const b = flow(2, { id: "fl_b" });
    const win = applyChanges(emptyWindow, [created(b), created(a)]);
    expect(ids(win)).toEqual(["fl_a", "fl_b"]);
  });

  test("replaces a changed flow in place without counting it again", () => {
    const saved = flow(2, { savedRequestId: "rq_1" });
    const win = applyChanges(windowFromPage([flow(3), flow(2), flow(1)], 10, 3), [updated(saved)]);
    expect(win.flows[1]).toBe(saved);
    expect(win.total).toBe(3);
  });

  test("replaces a flow the first page already had, without counting it again", () => {
    const win = applyChanges(windowFromPage([flow(2), flow(1)], 10, 2), [created(flow(2))]);
    expect(ids(win)).toEqual(["fl_01", "fl_02"]);
    expect(win.total).toBe(2);
  });

  test("leaves a flow older than the window to paging, but counts it", () => {
    const win = applyChanges(windowFromPage([flow(5), flow(4)], 2, 9), [created(flow(1))]);
    expect(ids(win)).toEqual(["fl_04", "fl_05"]);
    expect(win.total).toBe(10);
  });

  test("keeps an older flow when the window already holds everything", () => {
    const win = applyChanges(windowFromPage([flow(5), flow(4)], 10, 2), [created(flow(1))]);
    expect(ids(win)).toEqual(["fl_01", "fl_04", "fl_05"]);
  });

  test("returns the same window for no changes", () => {
    const win = windowFromPage([flow(1)], 10, 1);
    expect(applyChanges(win, [])).toBe(win);
  });
});

describe("trimWindow", () => {
  const many = (n: number) =>
    windowFromPage(
      Array.from({ length: n }, (_, i) => flow(n - i)),
      1000,
      n,
    );

  test("leaves the window alone within the slack", () => {
    const win = many(7);
    expect(trimWindow(win, 4, 3)).toBe(win);
  });

  test("drops the oldest back to the size, an even number of them", () => {
    const even = trimWindow(many(8), 4, 3);
    expect(ids(even)).toEqual(["fl_05", "fl_06", "fl_07", "fl_08"]);
    expect(even).toMatchObject({ hasOlder: true, total: 8 });
    // Five over rounds up to six, so the list's stripes stay on the same flows.
    expect(ids(trimWindow(many(9), 4, 3))).toEqual(["fl_07", "fl_08", "fl_09"]);
  });
});

describe("prependOlder", () => {
  test("adds an older page before the oldest flow held", () => {
    const win = prependOlder(windowFromPage([flow(5), flow(4)], 2, 5), [flow(3), flow(2)], 2);
    expect(ids(win)).toEqual(["fl_02", "fl_03", "fl_04", "fl_05"]);
    expect(win.hasOlder).toBe(true);
  });

  test("knows it reached the start when a page comes back short", () => {
    const win = prependOlder(windowFromPage([flow(5), flow(4)], 2, 3), [flow(1)], 2);
    expect(ids(win)).toEqual(["fl_01", "fl_04", "fl_05"]);
    expect(win.hasOlder).toBe(false);
  });

  test("skips flows the window already has", () => {
    const win = prependOlder(windowFromPage([flow(5), flow(4)], 2, 5), [flow(4), flow(3)], 2);
    expect(ids(win)).toEqual(["fl_03", "fl_04", "fl_05"]);
  });

  test("keeps a slow flow that ended while the page loaded, once its changes apply again", () => {
    const before = windowFromPage([flow(5), flow(4)], 2, 5);
    // Ended mid-request, older than the window, so left out, and missing from the page.
    const slow = created(flow(2));
    const live = applyChanges(before, [slow]);
    expect(ids(live)).toEqual(["fl_04", "fl_05"]);
    const merged = prependOlder(live, [flow(3), flow(1)], 2);
    const replayed = applyChanges(merged, [slow]);
    expect(ids(replayed)).toEqual(["fl_01", "fl_02", "fl_03", "fl_04", "fl_05"]);
  });
});
