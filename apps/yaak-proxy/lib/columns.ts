import type { Flow, FlowSortKey, SortColumn } from "@yaakapp-internal/proxy-lib";
import { compareFlows } from "./flowWindow";
import { fieldTerm } from "./query";
import { sidebarPath } from "./search";

/** The columns the list has built in; each sorts by the `SortColumn` of the same name */
export type BuiltinColumnId = SortColumn;

/** A column of a header or query parameter the person added, by its field's path */
export type CustomColumnId = `field:${string}`;

export type ColumnId = BuiltinColumnId | CustomColumnId;

export interface ColumnDef {
  id: ColumnId;
  /** In the header and the picker */
  label: string;
  /** Pixels of content, at the default interface size; each cell adds `CELL_PADDING` */
  width: number;
  minWidth: number;
  align: "left" | "right";
  /** Shown until the person hides it */
  defaultVisible: boolean;
  /** The header or query parameter a custom column shows: `header.x-request-id` */
  path?: string;
  /**
   * A numeric column's: its width, resized or not, grows with the interface size, as its values
   * do, so the least width always holds the widest value
   */
  scales?: boolean;
}

const builtin = (
  id: BuiltinColumnId,
  label: string,
  width: number,
  minWidth: number,
  align: "left" | "right",
  defaultVisible: boolean,
  scales?: boolean,
): ColumnDef => ({ id, label, width, minWidth, align, defaultVisible, scales });

/**
 * The widest size and duration a numeric cell shows, in characters: `999.9 KB` and `999m 59s`,
 * from `formatSize` and `formatMillis`
 */
export const NUMERIC_FIT_CHARS = 8;

/**
 * Room for one character of a numeric cell, `font-mono text-xs`: 0.8rem, and a monospace advance
 * of 0.6em, JetBrains Mono's and most others', with a little over for wider editor fonts
 */
export const CHAR_REM = 0.5;

/** The default interface font size, `DEFAULT_SETTINGS_VALUES.interfaceFontSize`, widths are at */
export const BASE_FONT_SIZE = 15;

/**
 * A numeric column's least width, in pixels at the default interface size, which grow with it:
 * its widest value
 */
const NUMERIC_MIN = NUMERIC_FIT_CHARS * CHAR_REM * BASE_FONT_SIZE;

export const COLUMNS: ColumnDef[] = [
  builtin("number", "#", 46, 30, "left", true),
  builtin("app", "App", 20, 20, "left", true),
  builtin("method", "Method", 50, 40, "left", true),
  builtin("host", "Host", 190, 60, "left", true),
  builtin("path", "Path", 300, 60, "left", true),
  builtin("query", "Query", 120, 40, "left", true),
  builtin("status", "Status", 46, 34, "left", true),
  builtin("type", "Type", 50, 34, "left", true),
  // Each default fits its label sorted, with the sort's arrow and place, and its widest value
  builtin("requestSize", "Request Size", 96, NUMERIC_MIN, "right", false, true),
  builtin("size", "Size", 72, NUMERIC_MIN, "right", true, true),
  builtin("time", "Time", 64, NUMERIC_MIN, "right", true, true),
  builtin("latency", "Latency", 68, NUMERIC_MIN, "right", false, true),
  builtin("started", "Started", 92, 60, "left", false),
  builtin("remote", "Remote Address", 150, 60, "left", false),
  builtin("version", "HTTP Version", 70, 44, "left", false),
  builtin("tls", "TLS Version", 70, 34, "left", false),
  builtin("operation", "Operation", 160, 60, "left", false),
];

const DEFS = new Map<ColumnId, ColumnDef>(COLUMNS.map((c) => [c.id, c]));

/** Map fields a custom column can show, as the query language names them */
const CUSTOM_MAPS = ["req.header.", "res.header.", "header.", "query."];

/** `header.x-request-id` from what was typed, `@header.X-Request-Id:` included, or null */
export function customPath(typed: string): string | null {
  const path = typed.trim().replace(/^@/, "").replace(/:$/, "").trim();
  const map = CUSTOM_MAPS.find((m) => path.toLowerCase().startsWith(m));
  if (map == null) return null;
  const key = path.slice(map.length);
  // As a field path takes it, so the column's filter items make a term the search can run
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return null;
  return map + key.toLowerCase();
}

/** Why what was typed names no custom column, in a few words; null when it does or is empty */
export function customPathProblem(typed: string): string | null {
  if (customPath(typed) != null) return null;
  const path = typed.trim().replace(/^@/, "").replace(/:$/, "").trim().toLowerCase();
  if (path === "") return null;
  const map = CUSTOM_MAPS.find((m) => path.startsWith(m));
  if (map != null) return path === map ? "Missing name" : "Invalid name";
  // On the way to a map: `@hea`, `@req.header`
  if (CUSTOM_MAPS.some((m) => m.startsWith(path))) return "Incomplete";
  return "Unknown field";
}

/**
 * The edits that turn what the Add Column field holds into a reference to a field, `@` and its
 * path: an `@` in front when it lacks one, and no colon or space after, as a pasted
 * `@header.x-cache:` or a typed `header.x-cache` has. A lone `@` stays, to complete from.
 */
export function fieldReferenceChanges(
  text: string,
): { from: number; to: number; insert: string }[] {
  const lead = /^[\s@]*/.exec(text)?.[0].length ?? 0;
  const trail = /[\s:]*$/.exec(text.slice(lead))?.[0].length ?? 0;
  const end = text.length - trail;
  const at = end > lead || text.includes("@") ? "@" : "";
  const changes = [];
  if (text.slice(0, lead) !== at) changes.push({ from: 0, to: lead, insert: at });
  if (trail > 0) changes.push({ from: end, to: text.length, insert: "" });
  return changes;
}

/** What the Add Column field shows for `text`, `fieldReferenceChanges` made */
export function fieldReference(text: string): string {
  let result = text;
  for (const { from, to, insert } of [...fieldReferenceChanges(text)].reverse()) {
    result = result.slice(0, from) + insert + result.slice(to);
  }
  return result;
}

export function customColumnId(path: string): CustomColumnId {
  return `field:${path}`;
}

export function isCustomColumn(id: ColumnId): id is CustomColumnId {
  return id.startsWith("field:");
}

function customDef(id: CustomColumnId): ColumnDef {
  const path = id.slice("field:".length);
  return {
    id,
    label: path,
    width: 140,
    minWidth: 40,
    align: "left",
    defaultVisible: true,
    path,
  };
}

export function columnDef(id: ColumnId): ColumnDef {
  if (isCustomColumn(id)) return customDef(id);
  const def = DEFS.get(id);
  if (def == null) throw new Error(`No column ${id}`);
  return def;
}

/** The mark column, first and fixed */
export const MARK_WIDTH = 24;

/** Each cell's padding, both sides together, added to its column's width; `px-1.5` per side */
export const CELL_PADDING = "0.75rem";

/**
 * What the person chose: which columns show, the widths they dragged, by id, the header and
 * query parameter columns they added, in order, the order they dragged the columns into, and the
 * list's sort
 */
export interface ColumnPrefs {
  visible: Partial<Record<ColumnId, boolean>>;
  widths: Partial<Record<ColumnId, number>>;
  custom: CustomColumnId[];
  /**
   * The columns' order, by id. Columns not listed follow the listed ones, in their default order;
   * empty for the default order.
   */
  order: ColumnId[];
  /** The keys in order; empty for the order flows arrive in */
  sort: FlowSortKey[];
}

export const defaultColumnPrefs: ColumnPrefs = {
  visible: {},
  widths: {},
  custom: [],
  order: [],
  sort: [],
};

export interface Column extends ColumnDef {
  /** Its width now, in pixels of content */
  current: number;
}

/**
 * Every column, in the order the person left them: those they placed, then the rest in their
 * default order, the built-in ones before those added. The picker lists them so.
 */
export function allColumns(prefs: ColumnPrefs): ColumnDef[] {
  const defaults = [...COLUMNS, ...prefs.custom.map(customDef)];
  if (prefs.order.length === 0) return defaults;
  const byId = new Map(defaults.map((c) => [c.id, c]));
  const placed = prefs.order.flatMap((id) => byId.get(id) ?? []);
  return [...placed, ...defaults.filter((c) => !prefs.order.includes(c.id))];
}

function isVisible(prefs: ColumnPrefs, def: ColumnDef): boolean {
  return prefs.visible[def.id] ?? def.defaultVisible;
}

/**
 * The columns shown, in order. Each keeps its width however narrow the list is; the list scrolls
 * sideways instead. At least one always shows.
 */
export function shownColumns(prefs: ColumnPrefs, unavailable: ColumnId[] = []): Column[] {
  const all = allColumns(prefs).filter((c) => !unavailable.includes(c.id));
  const shown = all.filter((c) => isVisible(prefs, c));
  const columns = shown.length > 0 ? shown : all.filter((c) => c.id === "path");
  return columns.map((c) => ({ ...c, current: columnWidth(prefs, c.id) }));
}

/** Columns the platform has nothing for: App, where it cannot tell which app sent a flow */
export function unavailableColumns(hasApps: boolean): ColumnId[] {
  return hasApps ? [] : ["app"];
}

export function columnWidth(prefs: ColumnPrefs, id: ColumnId): number {
  const def = columnDef(id);
  return Math.max(def.minWidth, Math.round(prefs.widths[id] ?? def.width));
}

/** A column's content width, as CSS: a numeric column's grows with the interface size */
function columnTrack(c: Column): string {
  return c.scales ? `${c.current / BASE_FONT_SIZE}rem` : `${c.current}px`;
}

/**
 * How far a resize moved, in the pixels a column's width is kept in: a numeric column's are at
 * the default interface size, `rootFontSize` being the size now
 */
export function resizeDistance(c: ColumnDef, dx: number, rootFontSize: number): number {
  return c.scales && rootFontSize > 0 ? (dx * BASE_FONT_SIZE) / rootFontSize : dx;
}

/** The grid template for the header and every row: the mark, then each column and its padding */
export function gridTemplate(columns: Column[]): string {
  const cells = columns.map((c) => `calc(${columnTrack(c)} + ${CELL_PADDING})`);
  return [`${MARK_WIDTH}px`, ...cells].join(" ");
}

/** The width of a row's grid, as CSS: the list scrolls sideways when it is wider than the list */
export function gridWidth(columns: Column[]): string {
  const px = columns.filter((c) => !c.scales).reduce((sum, c) => sum + c.current, MARK_WIDTH);
  const scaled = columns.filter((c) => c.scales).map((c) => ` + ${columnTrack(c)}`);
  return `calc(${px}px${scaled.join("")} + ${columns.length} * ${CELL_PADDING})`;
}

/** Whether the picker may uncheck `id`: any column but the last one shown */
export function canHide(prefs: ColumnPrefs, id: ColumnId, unavailable: ColumnId[] = []): boolean {
  const shown = allColumns(prefs).filter((c) => !unavailable.includes(c.id) && isVisible(prefs, c));
  return !shown.every((c) => c.id === id);
}

export function toggleColumn(
  prefs: ColumnPrefs,
  id: ColumnId,
  unavailable: ColumnId[] = [],
): ColumnPrefs {
  const shown = isVisible(prefs, columnDef(id));
  if (shown && !canHide(prefs, id, unavailable)) return prefs;
  const next = { ...prefs, visible: { ...prefs.visible, [id]: !shown } };
  return shown ? next : placeAtEnd(next, id);
}

/**
 * Puts a column just shown after the others shown, unless the person placed it before, so it
 * goes back to that place. The columns shown before it are placed too, where they are, so the
 * ones not listed don't jump ahead of it. Until the person has ordered the columns, each keeps
 * its default place: a built-in one among the others, an added one at the end.
 */
function placeAtEnd(prefs: ColumnPrefs, id: ColumnId): ColumnPrefs {
  if (prefs.order.length === 0 || prefs.order.includes(id)) return prefs;
  const all = allColumns(prefs);
  if (all.filter((c) => isVisible(prefs, c)).at(-1)?.id === id) return prefs;
  const placed = all.filter(
    (c) => c.id !== id && (prefs.order.includes(c.id) || isVisible(prefs, c)),
  );
  return { ...prefs, order: [...placed.map((c) => c.id), id] };
}

/**
 * Moves a shown column to the boundary `to` between the columns shown: 0 before the first, their
 * count after the last. Hidden columns keep their places among the others.
 */
export function moveColumn(
  prefs: ColumnPrefs,
  id: ColumnId,
  to: number,
  unavailable: ColumnId[] = [],
): ColumnPrefs {
  const shown = shownColumns(prefs, unavailable).map((c) => c.id);
  const from = shown.indexOf(id);
  if (from === -1 || to < 0 || to > shown.length || to === from || to === from + 1) return prefs;
  // Every column shown, and those hidden that were placed, so they keep their places
  const order = allColumns(prefs)
    .filter((c) => c.id !== id && (prefs.order.includes(c.id) || shown.includes(c.id)))
    .map((c) => c.id);
  // Before the column at the boundary, or after the last one shown
  const before = shown[to];
  const last = shown.at(-1);
  const at = before != null ? order.indexOf(before) : last == null ? -1 : order.indexOf(last) + 1;
  if (at === -1) return prefs;
  order.splice(at, 0, id);
  return { ...prefs, order };
}

/** One place left, or with `1`, right, among the columns shown */
export function moveColumnBy(
  prefs: ColumnPrefs,
  id: ColumnId,
  by: -1 | 1,
  unavailable: ColumnId[] = [],
): ColumnPrefs {
  const from = shownColumns(prefs, unavailable).findIndex((c) => c.id === id);
  if (from === -1) return prefs;
  return moveColumn(prefs, id, by === -1 ? from - 1 : from + 2, unavailable);
}

/** Every column back to its default place */
export function resetOrder(prefs: ColumnPrefs): ColumnPrefs {
  return { ...prefs, order: [] };
}

/**
 * Where a dragged column would drop, from the pointer and the shown columns' edges, left to
 * right, as they are laid out before the drag: the boundary before the first column whose middle
 * is right of the pointer. Over its own column or the near half of a neighbour, that is an edge
 * of its own slot, where it would stay, so null. Left of the first column, over the fixed mark
 * column, it is the first boundary.
 */
export function dropBoundary(
  x: number,
  cells: { left: number; right: number }[],
  from: number,
): number | null {
  let at = cells.findIndex((r) => x < (r.left + r.right) / 2);
  if (at === -1) at = cells.length;
  const stays = from === -1 || at === from || at === from + 1;
  return stays ? null : at;
}

/**
 * How far, in pixels, each of `count` shown columns slides while the one at `from`, `width`
 * wide, is dragged to the boundary `to`: those it would pass make room for it, leftwards when it
 * goes right and rightwards when it goes left. The dragged column itself, and the rest, stay.
 */
export function columnShifts(
  count: number,
  from: number,
  width: number,
  to: number | null,
): number[] {
  return Array.from({ length: count }, (_, i) => {
    if (to == null || i === from) return 0;
    if (to > from && i > from && i < to) return -width;
    if (to < from && i >= to && i < from) return width;
    return 0;
  });
}

/** Shows `id` alone */
export function hideOtherColumns(prefs: ColumnPrefs, id: ColumnId): ColumnPrefs {
  const visible: ColumnPrefs["visible"] = {};
  for (const c of allColumns(prefs)) visible[c.id] = c.id === id;
  return { ...prefs, visible };
}

/**
 * Adds a column for a header or query parameter's path, shown at the end; already there, shown,
 * in its place
 */
export function addCustomColumn(prefs: ColumnPrefs, path: string): ColumnPrefs {
  const id = customColumnId(path);
  const custom = prefs.custom.includes(id) ? prefs.custom : [...prefs.custom, id];
  return placeAtEnd({ ...prefs, custom, visible: { ...prefs.visible, [id]: true } }, id);
}

/** Takes the column out, and out of the order and the sort */
export function removeCustomColumn(prefs: ColumnPrefs, id: CustomColumnId): ColumnPrefs {
  const { [id]: _v, ...visible } = prefs.visible;
  const { [id]: _w, ...widths } = prefs.widths;
  const custom = prefs.custom.filter((c) => c !== id);
  const order = prefs.order.filter((c) => c !== id);
  const sort = prefs.sort.filter((k) => k.column !== id);
  return { ...prefs, custom, visible, widths, order, sort };
}

export function resizeColumn(prefs: ColumnPrefs, id: ColumnId, width: number): ColumnPrefs {
  const w = Math.max(columnDef(id).minWidth, Math.round(width));
  return { ...prefs, widths: { ...prefs.widths, [id]: w } };
}

export function resetWidths(prefs: ColumnPrefs): ColumnPrefs {
  return { ...prefs, widths: {} };
}

/** One column back to its default width */
export function resetWidth(prefs: ColumnPrefs, id: ColumnId): ColumnPrefs {
  const { [id]: _, ...widths } = prefs.widths;
  return { ...prefs, widths };
}

/** Shows Operation the first time a flow has one, unless the person ever set it themselves */
export function showOperationFor(prefs: ColumnPrefs, flows: Flow[]): ColumnPrefs {
  if (prefs.visible.operation !== undefined) return prefs;
  if (!flows.some((f) => (operationOf(f) ?? "") !== "")) return prefs;
  return { ...prefs, visible: { ...prefs.visible, operation: true } };
}

/**
 * Reads stored preferences, dropping what no longer applies: unknown ids, and values of the
 * wrong type, so a change to the columns never breaks the list.
 */
export function parseColumnPrefs(value: unknown): ColumnPrefs {
  const prefs: ColumnPrefs = { visible: {}, widths: {}, custom: [], order: [], sort: [] };
  if (value == null || typeof value !== "object") return prefs;
  const { visible, widths, custom, order, sort } = value as Record<string, unknown>;
  if (Array.isArray(custom)) {
    for (const id of custom) {
      if (typeof id !== "string" || !id.startsWith("field:")) continue;
      const path = customPath(id.slice("field:".length));
      if (path != null && !prefs.custom.includes(customColumnId(path))) {
        prefs.custom.push(customColumnId(path));
      }
    }
  }
  for (const def of allColumns(prefs)) {
    const v = (visible as Record<string, unknown> | undefined)?.[def.id];
    if (typeof v === "boolean") prefs.visible[def.id] = v;
    const w = (widths as Record<string, unknown> | undefined)?.[def.id];
    // Narrower than the column's least width, as a numeric column's was before it grew, rises to it
    if (typeof w === "number" && Number.isFinite(w) && w > 0) {
      prefs.widths[def.id] = Math.max(def.minWidth, w);
    }
  }
  // Columns no longer there are dropped; those not listed follow the rest in their default order
  if (Array.isArray(order)) {
    for (const column of order) {
      if (typeof column !== "string") continue;
      const id = column as ColumnId;
      const known = isCustomColumn(id) ? prefs.custom.includes(id) : DEFS.has(id);
      if (known && !prefs.order.includes(id)) prefs.order.push(id);
    }
  }
  if (Array.isArray(sort)) {
    for (const key of sort) {
      if (key == null || typeof key !== "object") continue;
      const { column, descending } = key as Record<string, unknown>;
      if (typeof column !== "string" || typeof descending !== "boolean") continue;
      // A built-in column, or one the person added that is still there
      const id = column as ColumnId;
      const known = isCustomColumn(id) ? prefs.custom.includes(id) : DEFS.has(id);
      if (!known || prefs.sort.some((k) => k.column === id)) continue;
      prefs.sort.push({ column: id, descending });
    }
  }
  return prefs;
}

// -- Sorting --

/** Numbers sort largest first on the first click, names from A */
export function firstDirection(column: ColumnId): boolean {
  switch (column) {
    case "number":
    case "status":
    case "size":
    case "requestSize":
    case "time":
    case "latency":
      return true;
    default:
      return false;
  }
}

/**
 * A click on a column's label: sort by it alone, reverse the sort it has alone, then, from the
 * reversed sort, go back to the order flows arrive in
 */
export function nextSort(sort: FlowSortKey[], column: ColumnId): FlowSortKey[] {
  const first = firstDirection(column);
  const only = sort.length === 1 ? sort[0] : null;
  if (only?.column !== column) return [{ column, descending: first }];
  if (only.descending === first) return [{ column, descending: !first }];
  return [];
}

/**
 * An Option-click on a column's label: adds it as the last key, ascending; again reverses it, and
 * a third time takes it out
 */
export function toggleSortKey(sort: FlowSortKey[], column: ColumnId): FlowSortKey[] {
  const key = sort.find((k) => k.column === column);
  if (key == null) return [...sort, { column, descending: false }];
  if (!key.descending)
    return sort.map((k) => (k.column === column ? { column, descending: true } : k));
  return sort.filter((k) => k.column !== column);
}

/** Adds `column` as a key in `descending` order: the last key, or in its place if it is one */
export function addSortKey(
  sort: FlowSortKey[],
  column: ColumnId,
  descending: boolean,
): FlowSortKey[] {
  if (sort.some((k) => k.column === column)) {
    return sort.map((k) => (k.column === column ? { column, descending } : k));
  }
  return [...sort, { column, descending }];
}

/** What an empty number sorts as, below every value; `EMPTY_NUMBER` in the lib's `flows.rs` */
const EMPTY_NUMBER = -1e18;

/** Text as SQLite's `NOCASE` compares it: ASCII letters lowercased, nothing else changed */
function noCase(text: string | null | undefined): string {
  return (text ?? "").replace(/[A-Z]/g, (c) => c.toLowerCase());
}

function emptyNumber(n: number | null | undefined): number {
  return n == null || n === 0 ? EMPTY_NUMBER : n;
}

/**
 * The value `column` sorts `flow` by, as `SortBy::sql` in the lib's `flows.rs` makes it in the
 * database, so a flow placed here lands where a page read from there would have it. A custom
 * column's is the value it shows, as text.
 */
export function columnSortKey(flow: Flow, column: ColumnId): string | number {
  if (isCustomColumn(column)) return noCase(customValue(flow, column.slice("field:".length)));
  switch (column) {
    case "number":
      return flow.number;
    case "app":
      return noCase(flow.clientName ?? flow.clientBundleId ?? flow.clientPath);
    case "method":
      return noCase(flow.method);
    case "host":
      return noCase(urlParts(flow.url).authority);
    case "path":
      return noCase(urlParts(flow.url).path);
    case "query":
      return noCase(urlParts(flow.url).query);
    case "status":
      return flow.error != null ? -1 : emptyNumber(flow.status);
    case "type":
      return noCase(flow.contentType);
    case "size":
      return flow.error != null && flow.status == null
        ? EMPTY_NUMBER
        : emptyNumber(flow.responseSize);
    case "requestSize":
      return emptyNumber(flow.requestSize);
    case "time":
      return emptyNumber(flow.elapsedMs);
    case "latency":
      return emptyNumber(flow.elapsedHeadersMs);
    case "started":
      return flow.startedAt;
    case "remote":
      return noCase(flow.remoteAddr);
    case "version":
      return noCase(flow.upstreamHttpVersion ?? flow.clientHttpVersion);
    case "tls":
      return noCase(flow.upstreamTlsVersion);
    case "operation":
      return noCase(
        flow.grpcService != null && flow.grpcMethod != null
          ? `${flow.grpcService}/${flow.grpcMethod}`
          : flow.graphqlOperation,
      );
  }
}

function compareKeys(a: string | number, b: string | number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Orders flows as `list_flows` orders them for `sort`: each key in turn, then by start and id,
 * oldest first
 */
export function sortComparator(sort: FlowSortKey[]): (a: Flow, b: Flow) => number {
  return (a, b) => {
    for (const { column, descending } of sort) {
      const c = compareKeys(columnSortKey(a, column), columnSortKey(b, column));
      if (c !== 0) return descending ? -c : c;
    }
    return compareFlows(a, b);
  };
}

/** The flows in `sort`'s order, as the database orders them */
export function sortFlows(flows: Flow[], sort: FlowSortKey[]): Flow[] {
  if (sort.length === 0) return flows;
  return [...flows].sort(sortComparator(sort));
}

// -- Values --

/**
 * A URL's parts as the lib's `url_parts` reads them: no scheme, all host; otherwise the
 * authority up to the first `/`, `?` or `#`, then the path and the query without its `?`
 */
export function urlParts(url: string): { authority: string; path: string; query: string | null } {
  const start = url.indexOf("://");
  if (start === -1) return { authority: url, path: "", query: null };
  const rest = url.slice(start + 3);
  const end = rest.search(/[/?#]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  const tail = (end === -1 ? "" : rest.slice(end)).split("#")[0] ?? "";
  const q = tail.indexOf("?");
  return q === -1
    ? { authority, path: tail, query: null }
    : { authority, path: tail.slice(0, q), query: tail.slice(q + 1) };
}

/** The URL's host, with its port */
export function hostOf(url: string): string {
  return url.includes("://") ? urlParts(url).authority : "";
}

/** `Service/Method` for a gRPC call, the operation's name for GraphQL, or null */
export function operationOf(flow: Flow): string | null {
  if (flow.grpcService != null && flow.grpcMethod != null) {
    return `${flow.grpcService}/${flow.grpcMethod}`;
  }
  return flow.graphqlOperation ?? null;
}

/** `1.3` from `TLSv1.3` */
export function tlsVersionOf(flow: Flow): string {
  return (flow.upstreamTlsVersion ?? "").replace(/^TLSv?/i, "");
}

/**
 * The value of a custom column's path for `flow`: a header's first value, the response's before
 * the request's for `header.`, or a query parameter's first value
 */
export function customValue(flow: Flow, path: string): string | null {
  const header = (headers: Flow["requestHeaders"], name: string) =>
    headers.find((h) => h.name.toLowerCase() === name)?.value ?? null;
  if (path.startsWith("req.header.")) {
    return header(flow.requestHeaders, path.slice("req.header.".length));
  }
  if (path.startsWith("res.header.")) {
    return header(flow.responseHeaders, path.slice("res.header.".length));
  }
  if (path.startsWith("header.")) {
    const name = path.slice("header.".length);
    return header(flow.responseHeaders, name) ?? header(flow.requestHeaders, name);
  }
  if (path.startsWith("query.")) {
    const query = urlParts(flow.url).query;
    if (query == null) return null;
    const name = path.slice("query.".length);
    for (const [key, value] of new URLSearchParams(query)) {
      if (key.toLowerCase() === name) return value;
    }
  }
  return null;
}

/**
 * The search term that finds flows with `flow`'s value in `column`, or excludes them, for the
 * cell's menu; null for columns with no field to match their value exactly
 */
export function cellFilterTerm(flow: Flow, column: ColumnId, negated: boolean): string | null {
  const term = (field: string, value: string | null | undefined) =>
    value == null || value === "" ? null : fieldTerm(field, value, negated);
  if (isCustomColumn(column)) {
    const path = column.slice("field:".length);
    return term(path, customValue(flow, path));
  }
  switch (column) {
    case "app":
      return term("app", flow.clientName ?? flow.clientBundleId ?? flow.clientPath);
    case "method":
      return term("method", flow.method);
    case "host":
      return term("host", sidebarPath(flow.url).split("/")[0]);
    case "path":
      return flow.tunnelled ? null : term("path", urlParts(flow.url).path);
    case "status":
      return flow.status == null ? null : term("status", String(flow.status));
    case "type":
      return term("type", flow.contentType?.split(";")[0]?.trim());
    case "operation": {
      if (flow.grpcService != null && flow.grpcMethod != null) {
        const both = `${fieldTerm("grpc.service", flow.grpcService)} ${fieldTerm("grpc.method", flow.grpcMethod)}`;
        return negated ? `-(${both})` : both;
      }
      return term("graphql.operation", flow.graphqlOperation);
    }
    default:
      return null;
  }
}
