import type { Flow } from "@yaakapp-internal/proxy-lib";
import { appKeyOf } from "./search";

export type ColumnId =
  | "number"
  | "app"
  | "method"
  | "host"
  | "path"
  | "status"
  | "type"
  | "size"
  | "time"
  | "remote"
  | "version";

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
}

export const COLUMNS: ColumnDef[] = [
  {
    id: "number",
    label: "#",
    width: 46,
    minWidth: 30,
    align: "right",
    defaultVisible: true,
  },
  {
    id: "app",
    label: "App",
    width: 18,
    minWidth: 18,
    align: "left",
    defaultVisible: true,
  },
  {
    id: "method",
    label: "Method",
    width: 50,
    minWidth: 40,
    align: "left",
    defaultVisible: true,
  },
  {
    id: "host",
    label: "Host",
    width: 190,
    minWidth: 60,
    align: "left",
    defaultVisible: true,
  },
  {
    id: "path",
    label: "Path",
    width: 360,
    minWidth: 80,
    align: "left",
    defaultVisible: true,
  },
  {
    id: "status",
    label: "Status",
    width: 46,
    minWidth: 34,
    align: "left",
    defaultVisible: true,
  },
  {
    id: "type",
    label: "Type",
    width: 50,
    minWidth: 34,
    align: "left",
    defaultVisible: true,
  },
  {
    id: "size",
    label: "Size",
    width: 72,
    minWidth: 44,
    align: "right",
    defaultVisible: true,
  },
  {
    id: "time",
    label: "Time",
    width: 64,
    minWidth: 44,
    align: "right",
    defaultVisible: true,
  },
  {
    id: "remote",
    label: "Remote Address",
    width: 150,
    minWidth: 60,
    align: "left",
    defaultVisible: false,
  },
  {
    id: "version",
    label: "HTTP Version",
    width: 70,
    minWidth: 44,
    align: "left",
    defaultVisible: false,
  },
];

const DEFS = new Map(COLUMNS.map((c) => [c.id, c]));

export function columnDef(id: ColumnId): ColumnDef {
  const def = DEFS.get(id);
  if (def == null) throw new Error(`No column ${id}`);
  return def;
}

/** The mark column, first and fixed */
export const MARK_WIDTH = 24;

/** Each cell's padding, both sides together, added to its column's width; `px-1.5` per side */
export const CELL_PADDING = "0.75rem";

/** What the person chose: which columns show, and the widths they dragged, by id */
export interface ColumnPrefs {
  visible: Partial<Record<ColumnId, boolean>>;
  widths: Partial<Record<ColumnId, number>>;
}

export const defaultColumnPrefs: ColumnPrefs = { visible: {}, widths: {} };

export interface Column extends ColumnDef {
  /** Its width now, in pixels of content */
  current: number;
}

/**
 * The columns shown, in order: the visible ones, the path always. Each keeps its width however
 * narrow the list is; the list scrolls sideways instead.
 */
export function shownColumns(prefs: ColumnPrefs): Column[] {
  return COLUMNS.filter((c) => c.id === "path" || (prefs.visible[c.id] ?? c.defaultVisible)).map(
    (c) => ({ ...c, current: columnWidth(prefs, c.id) }),
  );
}

export function columnWidth(prefs: ColumnPrefs, id: ColumnId): number {
  const def = columnDef(id);
  return Math.max(def.minWidth, Math.round(prefs.widths[id] ?? def.width));
}

/** The grid template for the header and every row: the mark, then each column and its padding */
export function gridTemplate(columns: Column[]): string {
  const cells = columns.map((c) => `calc(${c.current}px + ${CELL_PADDING})`);
  return [`${MARK_WIDTH}px`, ...cells].join(" ");
}

/** The width of a row's grid, as CSS: the list scrolls sideways when it is wider than the list */
export function gridWidth(columns: Column[]): string {
  const px = columns.reduce((sum, c) => sum + c.current, MARK_WIDTH);
  return `calc(${px}px + ${columns.length} * ${CELL_PADDING})`;
}

export function toggleColumn(prefs: ColumnPrefs, id: ColumnId): ColumnPrefs {
  if (id === "path") return prefs;
  const shown = prefs.visible[id] ?? columnDef(id).defaultVisible;
  return { ...prefs, visible: { ...prefs.visible, [id]: !shown } };
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

/**
 * Reads stored preferences, dropping what no longer applies: unknown ids, and values of the
 * wrong type, so a change to the columns never breaks the list.
 */
export function parseColumnPrefs(value: unknown): ColumnPrefs {
  const prefs: ColumnPrefs = { visible: {}, widths: {} };
  if (value == null || typeof value !== "object") return prefs;
  const { visible, widths } = value as Record<string, unknown>;
  for (const def of COLUMNS) {
    const v = (visible as Record<string, unknown> | undefined)?.[def.id];
    if (typeof v === "boolean") prefs.visible[def.id] = v;
    const w = (widths as Record<string, unknown> | undefined)?.[def.id];
    if (typeof w === "number" && Number.isFinite(w) && w > 0) prefs.widths[def.id] = w;
  }
  return prefs;
}

/** A sort by a column, or by start time when null */
export interface FlowSort {
  column: ColumnId;
  descending: boolean;
}

/** Numbers sort largest first on the first click, names from A */
export function firstDirection(column: ColumnId): boolean {
  return column === "number" || column === "size" || column === "time" || column === "status";
}

/**
 * A click on a column's label: sort by it, reverse the sort it has, then, from the reversed sort,
 * go back to start time
 */
export function nextSort(sort: FlowSort | null, column: ColumnId): FlowSort | null {
  const first = firstDirection(column);
  if (sort?.column !== column) return { column, descending: first };
  if (sort.descending === first) return { column, descending: !first };
  return null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

type Key = string | number | null;

function sortKey(flow: Flow, column: ColumnId): Key {
  switch (column) {
    case "number":
      return flow.number;
    case "app":
      return appKeyOf(flow);
    case "method":
      return flow.method;
    case "host":
      return hostOf(flow.url);
    case "path":
      return pathOf(flow.url);
    case "status":
      return flow.error != null ? -1 : flow.status;
    case "type":
      return flow.contentType;
    case "size":
      return flow.error != null && flow.status == null ? null : flow.responseSize;
    case "time":
      return flow.elapsedMs;
    case "remote":
      return flow.remoteAddr;
    case "version":
      return flow.upstreamHttpVersion ?? flow.clientHttpVersion;
  }
}

/**
 * The flows in `sort`'s order, those without a value (none, empty or zero) lowest, so first
 * ascending and last descending, then by start so equal values keep arrival order. Sorts the
 * flows given, which are the ones loaded, not the whole database: the database only ever reads
 * by start time, so no `ORDER BY` follows the column sort.
 */
export function sortFlows(flows: Flow[], sort: FlowSort | null): Flow[] {
  if (sort == null) return flows;
  const dir = sort.descending ? -1 : 1;
  const keyed = flows.map((flow, i) => ({ flow, i, key: sortKey(flow, sort.column) || null }));
  keyed.sort((a, b) => {
    let c: number;
    if (a.key == null || b.key == null) c = Number(b.key == null) - Number(a.key == null);
    else if (typeof a.key === "number" && typeof b.key === "number") c = a.key - b.key;
    else c = collator.compare(String(a.key), String(b.key));
    return c === 0 ? a.i - b.i : c * dir;
  });
  return keyed.map((k) => k.flow);
}

/** The URL's host, with its port */
export function hostOf(url: string): string {
  const start = url.indexOf("://");
  if (start === -1) return "";
  const rest = url.slice(start + 3);
  const end = rest.search(/[/?#]/);
  return end === -1 ? rest : rest.slice(0, end);
}

function pathOf(url: string): string {
  const start = url.indexOf("://");
  if (start === -1) return url;
  const rest = url.slice(start + 3);
  const end = rest.search(/[/?#]/);
  return end === -1 ? "/" : rest.slice(end);
}
