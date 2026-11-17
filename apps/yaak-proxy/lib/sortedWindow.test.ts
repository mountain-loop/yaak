import type { Flow, ModelPayload } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import { sortComparator } from "./columns";
import { appendPage, applySortedChanges, type SortedWindow } from "./sortedWindow";

function flow(n: number, status: number | null): Flow {
  return {
    id: `fl_${n}`,
    number: n,
    startedAt: `2026-11-09T12:00:0${n}`,
    status,
    error: null,
  } as Flow;
}

const bySize = sortComparator([{ column: "status", descending: true }]);
const upsert = (model: Flow, search?: ModelPayload["search"]): ModelPayload => ({
  model,
  change: { type: "upsert", created: true },
  ...(search == null ? {} : { search }),
});
const remove = (model: Flow): ModelPayload => ({ model, change: { type: "delete" } });
const numbers = (flows: Flow[]) => flows.map((f) => f.number);

describe("applySortedChanges", () => {
  const held = [flow(1, 500), flow(2, 404), flow(3, 200)];

  test("places a new or changed flow by the sort, and drops a deleted one", () => {
    let flows = applySortedChanges(held, null, [upsert(flow(4, 300))], bySize, null);
    expect(numbers(flows)).toEqual([1, 2, 4, 3]);
    flows = applySortedChanges(flows, null, [upsert(flow(3, 503))], bySize, null);
    expect(numbers(flows)).toEqual([3, 1, 2, 4]);
    flows = applySortedChanges(flows, null, [remove(flow(1, 500))], bySize, null);
    expect(numbers(flows)).toEqual([3, 2, 4]);
  });

  test("leaves a flow past the last one read for paging to bring", () => {
    const boundary = held[2] ?? null;
    const flows = applySortedChanges(held, boundary, [upsert(flow(4, 100))], bySize, null);
    expect(numbers(flows)).toEqual([1, 2, 3]);
    // The last flow read, written again unchanged, stays.
    const same = applySortedChanges(held, boundary, [upsert(flow(3, 200))], bySize, null);
    expect(numbers(same)).toEqual([1, 2, 3]);
    // A held flow that moves past the end leaves until paging reaches it.
    const moved = applySortedChanges(held, boundary, [upsert(flow(1, 100))], bySize, null);
    expect(numbers(moved)).toEqual([2, 3]);
  });

  test("searching, takes only flows the search matched, and keeps ones it can't tell", () => {
    const changes = [
      upsert(flow(4, 300), { key: "k", matches: true }),
      upsert(flow(5, 300), { key: "k", matches: false }),
      upsert(flow(2, 404), { key: "k", matches: false }),
      upsert(flow(3, 999), { key: "other", matches: true }),
    ];
    const flows = applySortedChanges(held, null, changes, bySize, "k");
    expect(numbers(flows)).toEqual([1, 4, 3]);
  });
});

test("a page adds what it does not already hold", () => {
  const win: SortedWindow = {
    key: "1",
    sort: [],
    query: null,
    flows: [flow(1, 500), flow(2, 404)],
    boundary: flow(2, 404),
    cursor: [404, "fl_2"],
    loading: false,
    buffered: [],
  };
  const next = appendPage(win, [flow(2, 404), flow(3, 200)], [200, "fl_3"], 2);
  expect(numbers(next.flows)).toEqual([1, 2, 3]);
  expect(next.boundary?.id).toBe("fl_3");
  expect(next.cursor).toEqual([200, "fl_3"]);
  // A short page is the last: nothing is past it.
  const last = appendPage(win, [flow(3, 200)], [200, "fl_3"], 2);
  expect([last.boundary, last.cursor]).toEqual([null, null]);
  // One the sweep deleted meanwhile is left out, but still marks where the page ended.
  const swept = appendPage(
    win,
    [flow(3, 200), flow(4, 100)],
    [100, "fl_4"],
    2,
    (f) => f.id !== "fl_4",
  );
  expect(numbers(swept.flows)).toEqual([1, 2, 3]);
  expect(swept.boundary?.id).toBe("fl_4");
});
