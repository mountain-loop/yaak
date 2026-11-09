import type { Flow } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import {
  type ColumnPrefs,
  defaultColumnPrefs,
  gridTemplate,
  gridWidth,
  nextSort,
  parseColumnPrefs,
  resetWidth,
  resetWidths,
  resizeColumn,
  shownColumns,
  sortFlows,
  toggleColumn,
} from "./columns";

function flow(number: number, extra: Partial<Flow> = {}): Flow {
  return {
    id: `fl_${number}`,
    number,
    url: "https://example.com/",
    method: "GET",
    status: 200,
    error: null,
    responseSize: 0,
    elapsedMs: null,
    contentType: null,
    clientName: null,
    clientBundleId: null,
    clientPath: null,
    clientCwd: null,
    ...extra,
  } as Flow;
}

const ids = (prefs: ColumnPrefs) => shownColumns(prefs).map((c) => c.id);

describe("shownColumns", () => {
  test("shows every visible column, however narrow the list", () => {
    expect(ids(defaultColumnPrefs)).toEqual([
      "number",
      "app",
      "method",
      "host",
      "path",
      "status",
      "type",
      "size",
      "time",
    ]);
  });

  test("follows the picker, and always keeps the path", () => {
    let prefs = toggleColumn(defaultColumnPrefs, "remote");
    prefs = toggleColumn(prefs, "type");
    prefs = toggleColumn(prefs, "path");
    expect(ids(prefs)).toContain("remote");
    expect(ids(prefs)).not.toContain("type");
    expect(ids(prefs)).toContain("path");
  });

  test("lays out every column at a fixed width, the path included", () => {
    let prefs = resizeColumn(defaultColumnPrefs, "host", 240.4);
    prefs = resizeColumn(prefs, "path", 500);
    const columns = shownColumns(prefs);
    const pad = (w: number) => `calc(${w}px + 0.75rem)`;
    expect(gridTemplate(columns)).toBe(
      ["24px", ...[46, 18, 50, 240, 500, 46, 50, 72, 64].map(pad)].join(" "),
    );
    expect(gridWidth(columns)).toBe("calc(1110px + 9 * 0.75rem)");
  });

  test("keeps the host's width in a narrow list", () => {
    const host = shownColumns(defaultColumnPrefs).find((c) => c.id === "host");
    expect(host?.current).toBe(190);
  });
});

describe("column preferences", () => {
  test("persist through storage and drop what no longer applies", () => {
    let prefs = resizeColumn(defaultColumnPrefs, "host", 10);
    prefs = toggleColumn(prefs, "number");
    const stored = JSON.parse(JSON.stringify(prefs));
    expect(parseColumnPrefs(stored)).toEqual({ visible: { number: false }, widths: { host: 60 } });
    expect(
      parseColumnPrefs({ visible: { gone: true, size: "yes" }, widths: { time: -1, size: 90 } }),
    ).toEqual({ visible: {}, widths: { size: 90 } });
    expect(parseColumnPrefs(null)).toEqual(defaultColumnPrefs);
    expect(resetWidths(prefs).widths).toEqual({});
  });

  test("a double-click resets one column's width", () => {
    let prefs = resizeColumn(defaultColumnPrefs, "host", 300);
    prefs = resizeColumn(prefs, "path", 400);
    expect(resetWidth(prefs, "path").widths).toEqual({ host: 300 });
  });
});

describe("sorting", () => {
  test("sorts numbers largest first and names from A, reverses, then goes back to start", () => {
    expect(nextSort(null, "size")).toEqual({ column: "size", descending: true });
    expect(nextSort(null, "host")).toEqual({ column: "host", descending: false });
    expect(nextSort({ column: "host", descending: false }, "host")).toEqual({
      column: "host",
      descending: true,
    });
    expect(nextSort({ column: "host", descending: true }, "host")).toBeNull();
    expect(nextSort({ column: "size", descending: true }, "size")).toEqual({
      column: "size",
      descending: false,
    });
    expect(nextSort({ column: "size", descending: false }, "size")).toBeNull();
    // Another column starts over.
    expect(nextSort({ column: "host", descending: true }, "size")).toEqual({
      column: "size",
      descending: true,
    });
  });

  test("sorts the loaded flows, those without a value lowest, ties in arrival order", () => {
    const a = flow(1, { responseSize: 10, elapsedMs: 5, url: "https://b.com/" });
    const b = flow(2, { responseSize: 300, elapsedMs: null, url: "https://a.com/" });
    const c = flow(3, { responseSize: 10, elapsedMs: 50, url: "https://c.com/" });
    const d = flow(4, { error: "DNS lookup failed", status: null, url: "https://a.com/" });
    const flows = [a, b, c, d];
    const by = (column: Parameters<typeof nextSort>[1], descending: boolean) =>
      sortFlows(flows, { column, descending }).map((f) => f.number);
    expect(by("size", true)).toEqual([2, 1, 3, 4]);
    expect(by("size", false)).toEqual([4, 1, 3, 2]);
    expect(by("time", true)).toEqual([3, 1, 2, 4]);
    expect(by("time", false)).toEqual([2, 4, 1, 3]);
    expect(by("host", false)).toEqual([2, 4, 1, 3]);
    expect(by("number", true)).toEqual([4, 3, 2, 1]);
    // Failures sort below every status.
    expect(by("status", true)).toEqual([1, 2, 3, 4]);
    expect(by("status", false)).toEqual([4, 1, 2, 3]);
    expect(sortFlows(flows, null)).toBe(flows);
  });

  test("flips flows with no status, type, size or time to the other end", () => {
    const done = flow(1, { status: 200, contentType: "text/html", responseSize: 5, elapsedMs: 9 });
    const pending = flow(2, { status: null, contentType: null, responseSize: 0, elapsedMs: null });
    const cancelled = flow(3, { status: null, cancelled: true, contentType: "" });
    const flows = [done, pending, cancelled];
    for (const column of ["status", "type", "size", "time"] as const) {
      expect(sortFlows(flows, { column, descending: true }).map((f) => f.number)).toEqual([
        1, 2, 3,
      ]);
      expect(sortFlows(flows, { column, descending: false }).map((f) => f.number)).toEqual([
        2, 3, 1,
      ]);
    }
  });
});
