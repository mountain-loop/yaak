import type { Flow } from "@yaakapp-internal/proxy-lib";
import type { TreeNode } from "@yaakapp-internal/ui";
import {
  appKeyOf,
  folderOf,
  formatFieldFilter,
  isSystemFlow,
  sidebarPath,
  siteOf,
  tokenize,
} from "./search";

export type SidebarKind = "all" | "group" | "app" | "site" | "host" | "path";

/** A row of the sidebar: All traffic, a group, an app, or a site, host or path under one */
export interface SidebarItem {
  id: string;
  kind: SidebarKind;
  label: string;
  /** Dim beside the label: a program's folder */
  sublabel?: string;
  /** Flows under the row, of those loaded */
  count: number;
  /** Shown instead of the count, as Domains says how many hosts */
  countLabel?: string;
  /** An app's path, for its icon */
  appPath?: string;
  /** What selecting the row writes into the search box; empty for all traffic */
  query: string;
}

/** The ids of All traffic and the groups */
export const ALL_ID = "all";
export const APPS_ID = "apps";
export const DOMAINS_ID = "domains";
export const SYSTEM_ID = "system";

/** A row a flow sits under, with what makes it, so a rebuild only looks it up */
interface PlaceRow {
  id: string;
  kind: "site" | "host" | "path";
  label: string;
  query: string;
}

/**
 * Where a flow sits, parsed once per flow rather than on every rebuild: its site, host and path
 * rows in Domains, and the same rows under its app.
 */
interface Place {
  /** What `@app` names its app by, or null when unknown */
  app: string | null;
  system: boolean;
  rows: PlaceRow[];
  appRows: PlaceRow[];
}

const places = new WeakMap<Flow, Place>();

function placeOf(flow: Flow): Place {
  let place = places.get(flow);
  if (place != null) return place;
  const path = sidebarPath(flow.url);
  const schemeless = !flow.url.includes("://");
  const [host = "", ...segments] = schemeless ? [path] : path.split("/");
  const site = siteOf(host);
  const app = appKeyOf(flow);
  const hostQuery = formatFieldFilter("host", host);
  const rows: PlaceRow[] = [
    {
      id: `site:${site}`,
      kind: "site",
      label: site,
      query: formatFieldFilter("host", `*.${site}`),
    },
    { id: `host:${host}`, kind: "host", label: host, query: hostQuery },
  ];
  let p = "";
  for (const segment of segments) {
    p += `/${segment}`;
    rows.push({
      id: `path:${host}${p}`,
      kind: "path",
      label: `/${segment}`,
      query: `${hostQuery} ${formatFieldFilter("path", p)}`,
    });
  }
  const appQuery = app == null ? "" : formatFieldFilter("app", app);
  const appRows =
    app == null
      ? []
      : rows.map((r) => ({ ...r, id: `app:${app}|${r.id}`, query: `${appQuery} ${r.query}` }));
  place = { app, system: isSystemFlow(flow), rows, appRows };
  places.set(flow, place);
  return place;
}

/** A node being built, its children by id */
interface Trie {
  item: SidebarItem;
  children: Map<string, Trie>;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Counts a flow under `parent`'s child `row`, making the child the first time */
function child(parent: Trie, row: PlaceRow): Trie {
  let node = parent.children.get(row.id);
  if (node == null) {
    node = {
      item: { id: row.id, kind: row.kind, label: row.label, count: 0, query: row.query },
      children: new Map(),
    };
    parent.children.set(row.id, node);
  }
  node.item.count++;
  return node;
}

/** Adds a flow under `parent` by where it went: its site, then its host, then its path */
function addPlace(parent: Trie, rows: PlaceRow[]) {
  let node = parent;
  for (const row of rows) node = child(node, row);
}

function toNodes(
  tries: Iterable<Trie>,
  parent: TreeNode<SidebarItem>,
  sort = byLabel,
): TreeNode<SidebarItem>[] {
  return [...tries].sort(sort).map((trie) => {
    const node: TreeNode<SidebarItem> = {
      item: trie.item,
      parent,
      depth: parent.depth + 1,
      children: [],
      draggable: false,
    };
    node.children = toNodes(trie.children.values(), node);
    return node;
  });
}

function byLabel(a: Trie, b: Trie): number {
  return collator.compare(a.item.label, b.item.label);
}

function group(id: string, label: string): Trie {
  return { item: { id, kind: "group", label, count: 0, query: "" }, children: new Map() };
}

/**
 * The sidebar: All traffic, then Apps, each app opening to its own sites, hosts and paths, then
 * Domains by site, host and path, then System, macOS's daemons, apart from the apps. A group with
 * nothing in it is left out. `total` is All traffic's count: every flow it covers in the
 * database.
 */
export function buildSidebarTree(flows: Flow[], total: number): TreeNode<SidebarItem> {
  const root: TreeNode<SidebarItem> = {
    item: { id: "root", kind: "group", label: "", count: 0, query: "" },
    parent: null,
    depth: 0,
    children: [],
    draggable: false,
  };
  const apps = group(APPS_ID, "Apps");
  const domains = group(DOMAINS_ID, "Domains");
  const system = { ...group(SYSTEM_ID, "System") };
  system.item.query = formatFieldFilter("is", "system");

  for (const flow of flows) {
    const place = placeOf(flow);
    domains.item.count++;
    addPlace(domains, place.rows);
    if (place.app == null) continue;
    const parent = place.system ? system : apps;
    const id = `app:${place.app}`;
    let app = parent.children.get(id);
    if (app == null) {
      const folder = folderOf(flow);
      const item: SidebarItem = {
        id,
        kind: "app",
        label: flow.clientName ?? place.app,
        count: 0,
        query: formatFieldFilter("app", place.app),
      };
      if (folder != null) item.sublabel = folder;
      if (flow.clientPath != null) item.appPath = flow.clientPath;
      app = { item, children: new Map() };
      parent.children.set(id, app);
    }
    app.item.count++;
    parent.item.count++;
    addPlace(app, place.appRows);
  }
  let hosts = 0;
  for (const site of domains.children.values()) hosts += site.children.size;
  domains.item.countLabel = hosts === 1 ? "1 host" : `${hosts} hosts`;

  root.children?.push({
    item: { id: ALL_ID, kind: "all", label: "All traffic", count: total, query: "" },
    parent: root,
    depth: 1,
    draggable: false,
  });
  for (const g of [apps, domains, system]) {
    if (g.children.size === 0) continue;
    const node: TreeNode<SidebarItem> = {
      item: g.item,
      parent: root,
      depth: 1,
      children: [],
      draggable: false,
    };
    node.children = toNodes(g.children.values(), node);
    root.children?.push(node);
  }
  return root;
}

/** Every row's item by id, for reading a selection */
export function itemsById(root: TreeNode<SidebarItem>): Map<string, SidebarItem> {
  const map = new Map<string, SidebarItem>();
  const walk = (node: TreeNode<SidebarItem>) => {
    map.set(node.item.id, node.item);
    for (const c of node.children ?? []) walk(c);
  };
  walk(root);
  return map;
}

/** The search text for the selected rows: their queries, OR'd; empty for All traffic */
export function selectionText(items: SidebarItem[]): string {
  const queries = [...new Set(items.map((i) => i.query))];
  if (queries.includes("")) return "";
  return queries.join(" OR ");
}

/**
 * Whether a row's query is still in the search text, every term of it among the text's: a row
 * stays selected while it is, so typing after selecting keeps it.
 */
export function queryInText(query: string, text: string): boolean {
  const have = new Set(tokenize(text).map(tokenKey));
  const want = tokenize(query);
  if (want.length === 0) return have.size === 0;
  return want.every((t) => have.has(tokenKey(t)));
}

function tokenKey(t: { field: string | null; value: string; negated: boolean }): string {
  return `${t.negated ? "-" : ""}${t.field ?? ""}:${t.value.toLowerCase()}`;
}
