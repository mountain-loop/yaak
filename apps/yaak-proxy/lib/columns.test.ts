import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow, FlowSortKey } from "@yaakapp-internal/proxy-lib";
// The formatter alone: the package index reaches for the window as it loads
import { formatMillis } from "../../../packages/ui/src/components/tags/HttpResponseDurationTag";
import { describe, expect, test } from "vite-plus/test";
import customSortFixture from "../../../crates-proxy/yaak-proxy-lib/tests/fixtures/custom_column_sort.json";
import {
  addCustomColumn,
  addSortKey,
  allColumns,
  BASE_FONT_SIZE,
  CHAR_REM,
  cellFilterTerm,
  columnDef,
  columnShifts,
  type ColumnPrefs,
  customPath,
  customPathProblem,
  customValue,
  defaultColumnPrefs,
  dropBoundary,
  fieldReference,
  fieldReferenceChanges,
  gridTemplate,
  gridWidth,
  hideOtherColumns,
  moveColumn,
  moveColumnBy,
  NUMERIC_FIT_CHARS,
  nextSort,
  operationOf,
  parseColumnPrefs,
  removeCustomColumn,
  resetOrder,
  resetWidth,
  resetWidths,
  resizeColumn,
  resizeDistance,
  showOperationFor,
  shownColumns,
  sortFlows,
  toggleColumn,
  toggleSortKey,
  urlParts,
} from "./columns";
import { DEFAULT_SETTINGS_VALUES } from "./settings";

function flow(number: number, extra: Partial<Flow> = {}): Flow {
  return {
    id: `fl_${String(number).padStart(3, "0")}`,
    number,
    startedAt: `2026-11-09T12:00:${String(number).padStart(2, "0")}`,
    url: "https://example.com/",
    method: "GET",
    status: 200,
    error: null,
    requestSize: 0,
    responseSize: 0,
    elapsedMs: null,
    elapsedHeadersMs: null,
    contentType: null,
    clientName: null,
    clientBundleId: null,
    clientPath: null,
    clientCwd: null,
    clientHttpVersion: "HTTP/1.1",
    upstreamHttpVersion: null,
    upstreamTlsVersion: null,
    remoteAddr: null,
    requestHeaders: [],
    responseHeaders: [],
    grpcService: null,
    grpcMethod: null,
    graphqlOperation: null,
    tunnelled: false,
    ...extra,
  } as Flow;
}

const ids = (prefs: ColumnPrefs) => shownColumns(prefs).map((c) => c.id);

describe("shownColumns", () => {
  test("shows every visible column, Query after Path", () => {
    expect(ids(defaultColumnPrefs)).toEqual([
      "number",
      "app",
      "method",
      "host",
      "path",
      "query",
      "status",
      "type",
      "size",
      "time",
    ]);
  });

  test("follows the picker, Path included, but keeps the last column", () => {
    let prefs = toggleColumn(defaultColumnPrefs, "remote");
    prefs = toggleColumn(prefs, "type");
    prefs = toggleColumn(prefs, "path");
    expect(ids(prefs)).toContain("remote");
    expect(ids(prefs)).not.toContain("type");
    expect(ids(prefs)).not.toContain("path");
    const alone = hideOtherColumns(defaultColumnPrefs, "host");
    expect(ids(alone)).toEqual(["host"]);
    expect(toggleColumn(alone, "host")).toBe(alone);
    // Where App has nothing to show, the last other column is the last one.
    const withApp = hideOtherColumns(defaultColumnPrefs, "app");
    const both = toggleColumn(withApp, "host");
    expect(toggleColumn(both, "host", ["app"])).toBe(both);
    expect(ids(both)).toEqual(["app", "host"]);
    expect(shownColumns(both, ["app"]).map((c) => c.id)).toEqual(["host"]);
  });

  test("lays out every column at a fixed width", () => {
    let prefs = resizeColumn(defaultColumnPrefs, "host", 240.4);
    prefs = resizeColumn(prefs, "path", 500);
    const columns = shownColumns(prefs);
    const pad = (w: number) => `calc(${w}px + 0.75rem)`;
    // Size and Time, in pixels at the default interface size of 15, grow with it
    const size = "calc(4.8rem + 0.75rem)";
    const time = `calc(${64 / 15}rem + 0.75rem)`;
    expect(gridTemplate(columns)).toBe(
      ["24px", ...[46, 20, 50, 240, 500, 120, 46, 50].map(pad), size, time].join(" "),
    );
    expect(gridWidth(columns)).toBe(`calc(1096px + 4.8rem + ${64 / 15}rem + 10 * 0.75rem)`);
    // Resized, too, and at its least width it holds its widest value: eight characters of 0.5rem
    const resized = shownColumns(resizeColumn(prefs, "size", 10));
    expect(gridTemplate(resized)).toContain(" calc(4rem + 0.75rem)");
  });
});

describe("numeric column widths", () => {
  // Every format the cells show: each unit's widest, and around each rounding edge
  const sizes = [0, 9, 999, 1000, 1001, 1049, 99_949, 99_951, 999_949, 999_999, 1_000_001];
  const giga = 999_949_000_000;
  const durations = [0, 999, 1000, 9_949, 9_999, 59_499, 59_999, 60_000, 3_599_499, 59_999_999];
  const numeric = ["size", "requestSize", "time", "latency"] as const;

  test("the formats' widest values are as many characters as each numeric column holds", () => {
    const widest = (values: string[]) => Math.max(...values.map((v) => v.length));
    const sizeChars = widest([...sizes, giga].map(formatSize));
    const timeChars = widest(durations.map(formatMillis));
    expect(sizeChars).toBe(8);
    expect(timeChars).toBe(8);
    for (const id of numeric) {
      const def = columnDef(id);
      const chars = id === "size" || id === "requestSize" ? sizeChars : timeChars;
      expect(NUMERIC_FIT_CHARS).toBeGreaterThanOrEqual(chars);
      expect(def.scales).toBe(true);
      // In pixels at the default interface size, as the row's font sets them
      const fit = NUMERIC_FIT_CHARS * CHAR_REM * BASE_FONT_SIZE;
      expect(def.minWidth).toBeGreaterThanOrEqual(fit);
      expect(def.width).toBeGreaterThanOrEqual(fit);
    }
  });

  test("the room for a character fits JetBrains Mono at text-xs", () => {
    // A monospace advance of 0.6em, at 0.8rem
    expect(CHAR_REM).toBeGreaterThanOrEqual(0.6 * 0.8);
    expect(BASE_FONT_SIZE).toBe(DEFAULT_SETTINGS_VALUES.interfaceFontSize);
  });

  test("defaults fit each label sorted, with the sort's arrow and place", () => {
    // Measured in the harness at the default interface size, sorted by four columns
    const header = { size: 46, requestSize: 96, time: 50, latency: 67 };
    for (const id of numeric) expect(columnDef(id).width).toBeGreaterThanOrEqual(header[id]);
  });

  test("a resize moves a numeric column's edge with the pointer at any interface size", () => {
    const size = columnDef("size");
    // At 30, twice the default, a 20px drag is 10 of the pixels its width is kept in
    expect(resizeDistance(size, 20, 30)).toBe(10);
    expect(resizeDistance(size, -12, 12)).toBe(-15);
    expect(resizeDistance(columnDef("host"), 20, 30)).toBe(20);
  });

  test("a stored width narrower than the least is raised, and a wider one kept", () => {
    const parsed = parseColumnPrefs({ widths: { size: 44, time: 50, requestSize: 120, host: 20 } });
    expect(parsed.widths).toEqual({ size: 60, time: 60, requestSize: 120, host: 60 });
    expect(shownColumns(parsed).find((c) => c.id === "size")?.current).toBe(60);
    expect(resizeColumn(defaultColumnPrefs, "latency", 10).widths).toEqual({ latency: 60 });
    // Reset, the defaults are back
    const reset = shownColumns(resetWidths(parsed)).find((c) => c.id === "size");
    expect(reset?.current).toBe(72);
    expect(resetWidth(parsed, "time").widths).toEqual({ size: 60, requestSize: 120, host: 60 });
  });
});

describe("column preferences", () => {
  test("persist through storage and drop what no longer applies", () => {
    let prefs = resizeColumn(defaultColumnPrefs, "host", 10);
    prefs = toggleColumn(prefs, "number");
    prefs = addCustomColumn(prefs, "header.x-cache");
    prefs = { ...prefs, sort: [{ column: "status", descending: true }] };
    const stored = JSON.parse(JSON.stringify(prefs));
    expect(parseColumnPrefs(stored)).toEqual({
      visible: { number: false, "field:header.x-cache": true },
      widths: { host: 60 },
      custom: ["field:header.x-cache"],
      order: [],
      sort: [{ column: "status", descending: true }],
    });
    expect(
      parseColumnPrefs({
        visible: { gone: true, size: "yes" },
        widths: { time: -1, size: 90 },
        custom: ["field:nope.x", 3, "field:query.page"],
        sort: [
          { column: "gone", descending: true },
          { column: "host" },
          { column: "time", descending: false },
        ],
      }),
    ).toEqual({
      visible: {},
      widths: { size: 90 },
      custom: ["field:query.page"],
      order: [],
      sort: [{ column: "time", descending: false }],
    });
    expect(parseColumnPrefs(null)).toEqual(defaultColumnPrefs);
    expect(resetWidths(prefs).widths).toEqual({});
  });

  test("a double-click resets one column's width", () => {
    let prefs = resizeColumn(defaultColumnPrefs, "host", 300);
    prefs = resizeColumn(prefs, "path", 400);
    expect(resetWidth(prefs, "path").widths).toEqual({ host: 300 });
  });

  test("custom columns are added at the end and removed with their settings", () => {
    let prefs = addCustomColumn(defaultColumnPrefs, "res.header.x-cache");
    prefs = resizeColumn(prefs, "field:res.header.x-cache", 200);
    expect(ids(prefs).at(-1)).toBe("field:res.header.x-cache");
    prefs = removeCustomColumn(prefs, "field:res.header.x-cache");
    expect(prefs).toEqual(defaultColumnPrefs);
  });

  test("a custom column's sort persists with it and goes when it does", () => {
    let prefs = addCustomColumn(defaultColumnPrefs, "header.x-cache");
    const sort: FlowSortKey[] = [
      { column: "field:header.x-cache", descending: true },
      { column: "status", descending: false },
    ];
    prefs = { ...prefs, sort };
    expect(parseColumnPrefs(JSON.parse(JSON.stringify(prefs))).sort).toEqual(sort);
    // A key for a column that is no longer there is dropped
    expect(parseColumnPrefs({ ...prefs, custom: [] }).sort).toEqual([sort[1]]);
    expect(removeCustomColumn(prefs, "field:header.x-cache").sort).toEqual([sort[1]]);
  });

  test("Operation shows itself once, unless the person set it", () => {
    const grpc = flow(1, { grpcService: "pkg.Greeter", grpcMethod: "SayHello" });
    const anonymous = flow(2, { graphqlOperation: "" });
    expect(showOperationFor(defaultColumnPrefs, [flow(3), anonymous])).toBe(defaultColumnPrefs);
    expect(showOperationFor(defaultColumnPrefs, [grpc]).visible.operation).toBe(true);
    const hidden = { ...defaultColumnPrefs, visible: { operation: false } };
    expect(showOperationFor(hidden, [grpc])).toBe(hidden);
  });
});

describe("column order", () => {
  const defaults = ids(defaultColumnPrefs);

  test("a column moves to the boundary it was dropped at", () => {
    expect(ids(moveColumn(defaultColumnPrefs, "status", 2))).toEqual([
      "number",
      "app",
      "status",
      "method",
      "host",
      "path",
      "query",
      "type",
      "size",
      "time",
    ]);
    // Rightwards, before the column at the boundary
    expect(ids(moveColumn(defaultColumnPrefs, "method", 5)).slice(2, 6)).toEqual([
      "host",
      "path",
      "method",
      "query",
    ]);
    // To either end
    expect(ids(moveColumn(defaultColumnPrefs, "time", 0))[0]).toBe("time");
    expect(ids(moveColumn(defaultColumnPrefs, "number", defaults.length)).at(-1)).toBe("number");
    // The picker lists them in the same order
    const moved = moveColumn(defaultColumnPrefs, "time", 0);
    expect(allColumns(moved)[0]?.id).toBe("time");
  });

  test("a drop where the column already is changes nothing", () => {
    expect(moveColumn(defaultColumnPrefs, "host", 3)).toBe(defaultColumnPrefs);
    expect(moveColumn(defaultColumnPrefs, "host", 4)).toBe(defaultColumnPrefs);
    expect(moveColumn(defaultColumnPrefs, "host", -1)).toBe(defaultColumnPrefs);
    expect(moveColumn(defaultColumnPrefs, "host", defaults.length + 1)).toBe(defaultColumnPrefs);
    // A hidden column has no place among those shown
    expect(moveColumn(defaultColumnPrefs, "latency", 0)).toBe(defaultColumnPrefs);
  });

  test("Move Left and Move Right go one place, and not past the ends", () => {
    expect(ids(moveColumnBy(defaultColumnPrefs, "host", -1)).slice(2, 5)).toEqual([
      "host",
      "method",
      "path",
    ]);
    expect(ids(moveColumnBy(defaultColumnPrefs, "host", 1)).slice(3, 6)).toEqual([
      "path",
      "host",
      "query",
    ]);
    expect(moveColumnBy(defaultColumnPrefs, "number", -1)).toBe(defaultColumnPrefs);
    expect(moveColumnBy(defaultColumnPrefs, "time", 1)).toBe(defaultColumnPrefs);
    // Where App has nothing to show, Number is next to Method
    expect(
      shownColumns(moveColumnBy(defaultColumnPrefs, "method", -1, ["app"]), ["app"]).map(
        (c) => c.id,
      )[0],
    ).toBe("method");
  });

  test("a hidden column keeps its place and comes back to it", () => {
    let prefs = moveColumn(defaultColumnPrefs, "time", 0);
    prefs = toggleColumn(prefs, "status");
    prefs = moveColumn(prefs, "host", 0);
    expect(ids(prefs)).not.toContain("status");
    prefs = toggleColumn(prefs, "status");
    expect(ids(prefs)).toEqual([
      "host",
      "time",
      "number",
      "app",
      "method",
      "path",
      "query",
      "status",
      "type",
      "size",
    ]);
  });

  test("never reordered, a built-in column turned on takes its default place", () => {
    // Request Size's default place is before Size
    const prefs = toggleColumn(defaultColumnPrefs, "requestSize");
    expect(prefs.order).toEqual([]);
    expect(ids(prefs).slice(-4)).toEqual(["type", "requestSize", "size", "time"]);
    // Among the built-in ones, so a custom column stays at the end
    const custom = addCustomColumn(defaultColumnPrefs, "header.x-cache");
    expect(ids(custom).at(-1)).toBe("field:header.x-cache");
    const both = toggleColumn(custom, "requestSize");
    expect(both.order).toEqual([]);
    expect(ids(both).slice(-4)).toEqual(["requestSize", "size", "time", "field:header.x-cache"]);
  });

  test("once reordered, a column turned on goes at the end, unless it had a place", () => {
    let prefs = moveColumn(defaultColumnPrefs, "time", 0);
    prefs = toggleColumn(prefs, "requestSize");
    expect(ids(prefs).at(-1)).toBe("requestSize");
    // Moved, hidden and shown again, it goes back where it was moved to
    const before = ids(prefs).indexOf("size");
    prefs = moveColumn(prefs, "requestSize", before);
    prefs = toggleColumn(toggleColumn(prefs, "requestSize"), "requestSize");
    expect(ids(prefs).slice(-3)).toEqual(["type", "requestSize", "size"]);
    // A custom column added goes at the end too
    expect(ids(addCustomColumn(prefs, "query.page")).at(-1)).toBe("field:query.page");
  });

  test("a custom column is added at the end and leaves the order when removed", () => {
    const moved = moveColumn(defaultColumnPrefs, "size", 0);
    let prefs = addCustomColumn(moved, "header.x-cache");
    expect(ids(prefs).at(-1)).toBe("field:header.x-cache");
    prefs = moveColumn(prefs, "field:header.x-cache", 1);
    expect(ids(prefs).slice(0, 2)).toEqual(["size", "field:header.x-cache"]);
    // Hidden and added again, it keeps its place
    prefs = addCustomColumn(toggleColumn(prefs, "field:header.x-cache"), "header.x-cache");
    expect(ids(prefs)[1]).toBe("field:header.x-cache");
    prefs = removeCustomColumn(prefs, "field:header.x-cache");
    expect(prefs.order).not.toContain("field:header.x-cache");
    expect(ids(prefs)).toEqual(ids(moved));
    // Added again, it starts over at the end
    expect(ids(addCustomColumn(prefs, "header.x-cache")).at(-1)).toBe("field:header.x-cache");
  });

  test("the order persists, and columns it doesn't list follow it in their default order", () => {
    let prefs = addCustomColumn(defaultColumnPrefs, "query.page");
    prefs = moveColumn(prefs, "field:query.page", 0);
    expect(parseColumnPrefs(JSON.parse(JSON.stringify(prefs))).order).toEqual(prefs.order);
    const parsed = parseColumnPrefs({
      custom: ["field:query.page"],
      order: ["time", "gone", 3, "time", "field:header.x-gone", "field:query.page", "host"],
    });
    expect(parsed.order).toEqual(["time", "field:query.page", "host"]);
    expect(ids(parsed)).toEqual([
      "time",
      "field:query.page",
      "host",
      "number",
      "app",
      "method",
      "path",
      "query",
      "status",
      "type",
      "size",
    ]);
    expect(parseColumnPrefs({ order: "time" }).order).toEqual([]);
  });

  test("a drag's target is the boundary nearest the pointer, null in its own slot", () => {
    // Four columns 100px wide from x 24, after the mark column; the third is dragged
    const cells = [24, 124, 224, 324].map((left) => ({ left, right: left + 100 }));
    const at = (x: number) => dropBoundary(x, cells, 2);
    // Over the mark column or the first's left half: the first boundary
    expect(at(5)).toBe(0);
    expect(at(60)).toBe(0);
    expect(at(80)).toBe(1);
    // The left neighbour's near half, its own column, the right neighbour's near half: staying
    expect(at(190)).toBeNull();
    expect(at(250)).toBeNull();
    expect(at(290)).toBeNull();
    expect(at(350)).toBeNull();
    // Past the right neighbour's middle, and past the end
    expect(at(380)).toBe(4);
    expect(at(900)).toBe(4);
    // The last column dragged to the end stays
    expect(dropBoundary(900, cells, 3)).toBeNull();
  });

  test("the columns a drag passes slide by its width to make room", () => {
    // Five columns; the second, 80px wide, is dragged
    expect(columnShifts(5, 1, 80, null)).toEqual([0, 0, 0, 0, 0]);
    // Right, to before the fifth: the third and fourth slide left
    expect(columnShifts(5, 1, 80, 4)).toEqual([0, 0, -80, -80, 0]);
    // Right, to the end: all after it slide left
    expect(columnShifts(5, 1, 80, 5)).toEqual([0, 0, -80, -80, -80]);
    // Left, to the start: the first slides right
    expect(columnShifts(5, 1, 80, 0)).toEqual([80, 0, 0, 0, 0]);
    // The fourth, dragged left to before the second: the second and third slide right
    expect(columnShifts(5, 3, 60, 1)).toEqual([0, 60, 60, 0, 0]);
  });

  test("Reset Column Order puts every column back", () => {
    let prefs = moveColumn(defaultColumnPrefs, "time", 0);
    prefs = toggleColumn(prefs, "latency");
    prefs = resetOrder(prefs);
    expect(prefs.order).toEqual([]);
    expect(ids(prefs)).toEqual([...defaults.slice(0, -1), "time", "latency"]);
  });
});

describe("sorting", () => {
  const one = (column: FlowSortKey["column"], descending: boolean) => [{ column, descending }];

  test("a click sorts by a column alone, reverses it, then goes back to arrival order", () => {
    expect(nextSort([], "size")).toEqual(one("size", true));
    expect(nextSort([], "host")).toEqual(one("host", false));
    expect(nextSort(one("host", false), "host")).toEqual(one("host", true));
    expect(nextSort(one("host", true), "host")).toEqual([]);
    expect(nextSort(one("size", true), "size")).toEqual(one("size", false));
    expect(nextSort(one("size", false), "size")).toEqual([]);
    // Another column, or a sort on several, starts over.
    expect(nextSort(one("host", true), "size")).toEqual(one("size", true));
    const two = [...one("host", false), ...one("size", true)];
    expect(nextSort(two, "host")).toEqual(one("host", false));
  });

  test("Option-click adds a key ascending, reverses it, then takes it out", () => {
    let sort = toggleSortKey(one("status", true), "host");
    expect(sort).toEqual([...one("status", true), ...one("host", false)]);
    sort = toggleSortKey(sort, "host");
    expect(sort).toEqual([...one("status", true), ...one("host", true)]);
    expect(toggleSortKey(sort, "host")).toEqual(one("status", true));
    expect(addSortKey(sort, "status", false)).toEqual([
      ...one("status", false),
      ...one("host", true),
    ]);
    expect(addSortKey([], "time", true)).toEqual(one("time", true));
  });

  test("a custom column sorts on click and Option-click as the others do", () => {
    const cache = "field:header.x-cache";
    expect(nextSort([], cache)).toEqual(one(cache, false));
    expect(nextSort(one(cache, false), cache)).toEqual(one(cache, true));
    expect(toggleSortKey(one("status", true), cache)).toEqual([
      ...one("status", true),
      ...one(cache, false),
    ]);
  });

  // Flows and the order each sort lists them in, shared with
  // `a_custom_column_sorts_by_its_value_and_pages` in the lib's `flows.rs`, which checks the
  // database lists them in the same order.
  test("a custom column sorts as the database does", () => {
    const fixture = customSortFixture as {
      flows: Partial<Flow>[];
      sorts: { sort: FlowSortKey[]; order: number[] }[];
    };
    const flows = fixture.flows.map((f, i) => flow(i, f));
    for (const { sort, order } of fixture.sorts) {
      expect(
        sortFlows(flows, sort).map((f) => f.number),
        JSON.stringify(sort),
      ).toEqual(order);
    }
  });

  // The same flows and orders as `a_sort_on_several_columns_pages_in_its_order` in the lib's
  // `flows.rs`, so the app places a flow where the database would.
  const flows = [
    flow(0, { url: "https://B.com/x", status: 200 }),
    flow(1, { url: "https://a.com/y", status: 404 }),
    flow(2, { url: "https://a.com/z", status: null }),
    flow(3, { url: "https://c.com/", status: 200 }),
    flow(4, { url: "https://a.com/", status: null, error: "boom" }),
    flow(5, { url: "https://b.com/q", status: 200 }),
    flow(6, { url: "https://A.com/", status: 404 }),
    flow(7, { url: "https://c.com/", status: 200 }),
  ];
  const numbers = (sort: FlowSortKey[]) => sortFlows(flows, sort).map((f) => f.number);

  test("sorts on several columns as the database does", () => {
    const status = [...one("status", true), ...one("host", false)];
    expect(numbers(status)).toEqual([1, 6, 0, 5, 3, 7, 4, 2]);
    const ascending = [...one("status", false), ...one("host", false)];
    expect(numbers(ascending)).toEqual([2, 4, 0, 5, 3, 7, 1, 6]);
    expect(numbers(one("query", true))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(sortFlows(flows, [])).toBe(flows);
  });

  test("sizes, times and the rest put flows without a value lowest", () => {
    const a = flow(1, { responseSize: 10, elapsedMs: 5, requestSize: 3, elapsedHeadersMs: 2 });
    const b = flow(2, { responseSize: 300, elapsedMs: null, requestSize: 0 });
    const c = flow(3, { responseSize: 10, elapsedMs: 50, elapsedHeadersMs: 40 });
    const d = flow(4, { error: "DNS lookup failed", status: null, responseSize: 99 });
    const four = [a, b, c, d];
    const by = (column: FlowSortKey["column"], descending: boolean) =>
      sortFlows(four, one(column, descending)).map((f) => f.number);
    expect(by("size", true)).toEqual([2, 1, 3, 4]);
    expect(by("size", false)).toEqual([4, 1, 3, 2]);
    expect(by("time", true)).toEqual([3, 1, 2, 4]);
    expect(by("latency", true)).toEqual([3, 1, 2, 4]);
    expect(by("requestSize", true)).toEqual([1, 2, 3, 4]);
    expect(by("number", true)).toEqual([4, 3, 2, 1]);
    // Failures sort below every status.
    expect(by("status", true)).toEqual([1, 2, 3, 4]);
    expect(by("status", false)).toEqual([4, 1, 2, 3]);
  });
});

describe("values", () => {
  test("splits URLs as the lib does", () => {
    expect(urlParts("https://a.com:8080/v1/x?page=2&q=1#top")).toEqual({
      authority: "a.com:8080",
      path: "/v1/x",
      query: "page=2&q=1",
    });
    expect(urlParts("https://a.com?x")).toEqual({ authority: "a.com", path: "", query: "x" });
    expect(urlParts("bank.example.com:443")).toEqual({
      authority: "bank.example.com:443",
      path: "",
      query: null,
    });
  });

  test("reads a custom column's path from what was typed", () => {
    expect(customPath("@header.X-Request-Id:")).toBe("header.x-request-id");
    expect(customPath("query.page")).toBe("query.page");
    expect(customPath(" res.header.x-cache ")).toBe("res.header.x-cache");
    expect(customPath("@host")).toBeNull();
    expect(customPath("header.")).toBeNull();
    expect(customPath("header.a b")).toBeNull();
    expect(customPath("query.filter[status]")).toBeNull();
  });

  test("says tersely why what was typed names no column", () => {
    expect(customPathProblem("")).toBeNull();
    expect(customPathProblem("@")).toBeNull();
    expect(customPathProblem("@req.header.user-agent")).toBeNull();
    expect(customPathProblem("@hea")).toBe("Incomplete");
    expect(customPathProblem("@res.header")).toBe("Incomplete");
    expect(customPathProblem("@header.")).toBe("Missing name");
    expect(customPathProblem("@query.a b")).toBe("Invalid name");
    expect(customPathProblem("@host")).toBe("Unknown field");
  });

  test("keeps the Add Column field a reference to a field", () => {
    expect(fieldReference("")).toBe("");
    expect(fieldReference("@")).toBe("@");
    expect(fieldReference("h")).toBe("@h");
    expect(fieldReference("header.x-cache")).toBe("@header.x-cache");
    expect(fieldReference("@req.header.user-agent:")).toBe("@req.header.user-agent");
    expect(fieldReference(" @@Header.X-Cache: ")).toBe("@Header.X-Cache");
    expect(fieldReference(":")).toBe("");
    expect(fieldReference("@:")).toBe("@");
    expect(fieldReferenceChanges("@header.x")).toEqual([]);
    expect(fieldReferenceChanges("query.page:")).toEqual([
      { from: 0, to: 0, insert: "@" },
      { from: 10, to: 11, insert: "" },
    ]);
  });

  test("a custom column shows the first value, the response's header before the request's", () => {
    const f = flow(1, {
      url: "https://a.com/?Page=2&page=3",
      requestHeaders: [
        { name: "X-Cache", value: "req" },
        { name: "Accept", value: "a" },
        { name: "accept", value: "b" },
      ],
      responseHeaders: [{ name: "x-cache", value: "HIT" }],
    });
    expect(customValue(f, "header.x-cache")).toBe("HIT");
    expect(customValue(f, "req.header.x-cache")).toBe("req");
    expect(customValue(f, "header.accept")).toBe("a");
    expect(customValue(f, "query.page")).toBe("2");
    expect(customValue(f, "query.nope")).toBeNull();
  });

  test("a cell's filter terms, where its column has a field to match", () => {
    const f = flow(1, {
      url: "https://api.stripe.com:443/v1/charges?x=1",
      status: 404,
      clientName: "Google Chrome",
      contentType: "application/json; charset=utf-8",
      responseHeaders: [{ name: "X-Cache", value: "HIT" }],
    });
    expect(cellFilterTerm(f, "host", false)).toBe("@host:api.stripe.com");
    expect(cellFilterTerm(f, "status", true)).toBe("-@status:404");
    expect(cellFilterTerm(f, "app", false)).toBe('@app:"Google Chrome"');
    expect(cellFilterTerm(f, "path", false)).toBe("@path:/v1/charges");
    expect(cellFilterTerm(f, "type", false)).toBe("@type:application/json");
    expect(cellFilterTerm(f, "field:header.x-cache", false)).toBe("@header.x-cache:HIT");
    for (const column of ["number", "size", "time", "query", "started"] as const) {
      expect(cellFilterTerm(f, column, false)).toBeNull();
    }
    const grpc = flow(2, { grpcService: "pkg.Greeter", grpcMethod: "SayHello" });
    expect(operationOf(grpc)).toBe("pkg.Greeter/SayHello");
    expect(cellFilterTerm(grpc, "operation", true)).toBe(
      "-(@grpc.service:pkg.Greeter @grpc.method:SayHello)",
    );
    const graphql = flow(3, { graphqlOperation: "GetUser" });
    expect(cellFilterTerm(graphql, "operation", false)).toBe("@graphql.operation:GetUser");
  });
});
