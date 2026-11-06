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
  /** Pixels, at the default interface size; the path takes what is left */
  width: number;
  minWidth: number;
  align: "left" | "right";
  /** Shown until the person hides it */
  defaultVisible: boolean;
  /** Kept when the list is narrow; the rest drop out below `WIDE_MIN_WIDTH` */
  narrow: boolean;
}

export const COLUMNS: ColumnDef[] = [
  {
    id: "number",
    label: "#",
    width: 46,
    minWidth: 30,
    align: "right",
    defaultVisible: true,
    narrow: false,
  },
  {
    id: "app",
    label: "App",
    width: 18,
    minWidth: 18,
    align: "left",
    defaultVisible: true,
    narrow: true,
  },
  {
    id: "method",
    label: "Method",
    width: 50,
    minWidth: 40,
    align: "left",
    defaultVisible: true,
    narrow: true,
  },
  {
    id: "host",
    label: "Host",
    width: 190,
    minWidth: 60,
    align: "left",
    defaultVisible: true,
    narrow: true,
  },
  {
    id: "path",
    label: "Path",
    width: 0,
    minWidth: 80,
    align: "left",
    defaultVisible: true,
    narrow: true,
  },
  {
    id: "status",
    label: "Status",
    width: 46,
    minWidth: 34,
    align: "left",
    defaultVisible: true,
    narrow: true,
  },
  {
    id: "type",
    label: "Type",
    width: 50,
    minWidth: 34,
    align: "left",
    defaultVisible: true,
    narrow: false,
  },
  {
    id: "size",
    label: "Size",
    width: 72,
    minWidth: 44,
    align: "right",
    defaultVisible: true,
    narrow: false,
  },
  {
    id: "time",
    label: "Time",
    width: 64,
    minWidth: 44,
    align: "right",
    defaultVisible: true,
    narrow: true,
  },
  {
    id: "remote",
    label: "Remote Address",
    width: 150,
    minWidth: 60,
    align: "left",
    defaultVisible: false,
    narrow: false,
  },
  {
    id: "version",
    label: "HTTP Version",
    width: 70,
    minWidth: 44,
    align: "left",
    defaultVisible: false,
    narrow: false,
  },
];

const DEFS = new Map(COLUMNS.map((c) => [c.id, c]));

export function columnDef(id: ColumnId): ColumnDef {
  const def = DEFS.get(id);
  if (def == null) throw new Error(`No column ${id}`);
  return def;
}

/** Below this width the list keeps only the narrow set: what a glance needs */
export const WIDE_MIN_WIDTH = 760;

/** The mark column, first and fixed */
export const MARK_WIDTH = 22;

/** What the person chose: which columns show, and the widths they dragged, by id */
export interface ColumnPrefs {
  visible: Partial<Record<ColumnId, boolean>>;
  widths: Partial<Record<ColumnId, number>>;
}

export const defaultColumnPrefs: ColumnPrefs = { visible: {}, widths: {} };

export interface Column extends ColumnDef {
  /** Its width now, in pixels; zero for the path, which takes the rest */
  current: number;
}

/**
 * The columns shown at `listWidth`, in order: the visible ones, less those outside the narrow set
 * when the list is narrower than `WIDE_MIN_WIDTH`. The path always shows. Measured, not by
 * layout, so a wide window side by side still gets size and type.
 */
export function shownColumns(prefs: ColumnPrefs, listWidth: number): Column[] {
  const wide = listWidth >= WIDE_MIN_WIDTH;
  return COLUMNS.filter((c) => {
    if (c.id === "path") return true;
    if (!(prefs.visible[c.id] ?? c.defaultVisible)) return false;
    return wide || c.narrow;
  }).map((c) => ({ ...c, current: currentWidth(prefs, c.id, listWidth) }));
}

/** The host gives way to the path in a narrow list, at most this share of its width */
const HOST_SHARE = 0.24;

function currentWidth(prefs: ColumnPrefs, id: ColumnId, listWidth: number): number {
  if (id === "path") return 0;
  const width = columnWidth(prefs, id);
  if (id !== "host" || listWidth <= 0) return width;
  return Math.max(columnDef(id).minWidth, Math.min(width, Math.round(listWidth * HOST_SHARE)));
}

export function columnWidth(prefs: ColumnPrefs, id: ColumnId): number {
  const def = columnDef(id);
  return Math.max(def.minWidth, Math.round(prefs.widths[id] ?? def.width));
}

/** The grid template for the header and every row */
export function gridTemplate(columns: Column[]): string {
  const cells = columns.map((c) =>
    c.id === "path" ? `minmax(${c.minWidth}px,1fr)` : `${c.current}px`,
  );
  return [`${MARK_WIDTH}px`, ...cells].join(" ");
}

export function toggleColumn(prefs: ColumnPrefs, id: ColumnId): ColumnPrefs {
  if (id === "path") return prefs;
  const shown = prefs.visible[id] ?? columnDef(id).defaultVisible;
  return { ...prefs, visible: { ...prefs.visible, [id]: !shown } };
}

export function resizeColumn(prefs: ColumnPrefs, id: ColumnId, width: number): ColumnPrefs {
  if (id === "path") return prefs;
  const w = Math.max(columnDef(id).minWidth, Math.round(width));
  return { ...prefs, widths: { ...prefs.widths, [id]: w } };
}

export function resetWidths(prefs: ColumnPrefs): ColumnPrefs {
  return { ...prefs, widths: {} };
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

/** A click on a column's label: sort by it, or reverse the sort it already has */
export function nextSort(sort: FlowSort | null, column: ColumnId): FlowSort {
  if (sort?.column === column) return { column, descending: !sort.descending };
  return { column, descending: firstDirection(column) };
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
 * The flows in `sort`'s order, without a value last either way, then by start so equal values
 * keep arrival order. Sorts the flows given, which are the ones loaded, not the whole database.
 */
export function sortFlows(flows: Flow[], sort: FlowSort | null): Flow[] {
  if (sort == null) return flows;
  const dir = sort.descending ? -1 : 1;
  const keyed = flows.map((flow, i) => ({ flow, i, key: sortKey(flow, sort.column) }));
  keyed.sort((a, b) => {
    if (a.key == null || b.key == null) {
      if (a.key == null && b.key == null) return a.i - b.i;
      return a.key == null ? 1 : -1;
    }
    let c: number;
    if (typeof a.key === "number" && typeof b.key === "number") c = a.key - b.key;
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
