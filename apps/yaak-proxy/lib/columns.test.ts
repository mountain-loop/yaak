import type { Flow } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import {
  type ColumnPrefs,
  defaultColumnPrefs,
  gridTemplate,
  nextSort,
  parseColumnPrefs,
  resetWidths,
  resizeColumn,
  shownColumns,
  sortFlows,
  toggleColumn,
  WIDE_MIN_WIDTH,
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

const ids = (prefs: ColumnPrefs, width: number) => shownColumns(prefs, width).map((c) => c.id);

describe("shownColumns", () => {
  test("shows the wide set when there is room, and the narrow set when not", () => {
    expect(ids(defaultColumnPrefs, WIDE_MIN_WIDTH)).toEqual([
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
    expect(ids(defaultColumnPrefs, WIDE_MIN_WIDTH - 1)).toEqual([
      "app",
      "method",
      "host",
      "path",
      "status",
      "time",
    ]);
  });

  test("follows the picker, and always keeps the path", () => {
    let prefs = toggleColumn(defaultColumnPrefs, "remote");
    prefs = toggleColumn(prefs, "type");
    prefs = toggleColumn(prefs, "path");
    expect(ids(prefs, 2000)).toContain("remote");
    expect(ids(prefs, 2000)).not.toContain("type");
    expect(ids(prefs, 2000)).toContain("path");
    // Off by default, and outside the narrow set.
    expect(ids(prefs, 400)).not.toContain("remote");
  });

  test("lays out fixed widths with the path taking the rest", () => {
    const prefs = resizeColumn(defaultColumnPrefs, "host", 240.4);
    const template = gridTemplate(shownColumns(prefs, 1200));
    expect(template).toBe("22px 46px 18px 50px 240px minmax(80px,1fr) 46px 50px 72px 64px");
  });

  test("lets the host give way to the path in a narrow list", () => {
    const host = (width: number) =>
      shownColumns(defaultColumnPrefs, width).find((c) => c.id === "host");
    expect(host(2000)?.current).toBe(190);
    expect(host(500)?.current).toBe(120);
    expect(host(100)?.current).toBe(60);
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
});

describe("sorting", () => {
  test("sorts numbers largest first and names from A, then reverses", () => {
    expect(nextSort(null, "size")).toEqual({ column: "size", descending: true });
    expect(nextSort(null, "host")).toEqual({ column: "host", descending: false });
    expect(nextSort({ column: "host", descending: false }, "host")).toEqual({
      column: "host",
      descending: true,
    });
  });

  test("sorts the loaded flows, those without a value last, ties in arrival order", () => {
    const a = flow(1, { responseSize: 10, elapsedMs: 5, url: "https://b.com/" });
    const b = flow(2, { responseSize: 300, elapsedMs: null, url: "https://a.com/" });
    const c = flow(3, { responseSize: 10, elapsedMs: 50, url: "https://c.com/" });
    const d = flow(4, { error: "DNS lookup failed", status: null, url: "https://a.com/" });
    const flows = [a, b, c, d];
    const by = (column: Parameters<typeof nextSort>[1], descending: boolean) =>
      sortFlows(flows, { column, descending }).map((f) => f.number);
    expect(by("size", true)).toEqual([2, 1, 3, 4]);
    expect(by("size", false)).toEqual([1, 3, 2, 4]);
    expect(by("time", true)).toEqual([3, 1, 2, 4]);
    expect(by("host", false)).toEqual([2, 4, 1, 3]);
    expect(by("number", true)).toEqual([4, 3, 2, 1]);
    // Failures sort below every status.
    expect(by("status", true)).toEqual([1, 2, 3, 4]);
    expect(sortFlows(flows, null)).toBe(flows);
  });
});
