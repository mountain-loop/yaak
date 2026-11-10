import type { Flow } from "@yaakapp-internal/proxy-lib";
import type { TreeNode } from "@yaakapp-internal/ui";
import type { DecryptSubject } from "./decrypt";
import {
  asOneTerm,
  fieldTerm,
  orGroupShapes,
  pathTerm,
  queryShape,
  siteTerm,
  termKeys,
} from "./query";
import { appKeyOf, folderOf, isSystemFlow, runtimeFolderOf, sidebarPath, siteOf } from "./search";

export type SidebarKind =
  | "all"
  | "tunnelled"
  | "saved"
  | "group"
  | "app"
  | "folder"
  | "site"
  | "host"
  | "path";

/**
 * A row of the sidebar: All traffic, a saved search, a group, an app, a program's working
 * directory, or a site, host or path under one
 */
export interface SidebarItem {
  id: string;
  kind: SidebarKind;
  label: string;
  /** Dim beside the label: a generic runtime's folder */
  sublabel?: string;
  /** Flows under the row, of those loaded; hosts, for Domains */
  count: number;
  /** An app's path, for its icon */
  appPath?: string;
  /** What selecting the row writes into the search box; empty for all traffic */
  query: string;
  /**
   * The row's own value excluded, without the rows above it, for Exclude This Value; set only on
   * the rows whose menu filters by them
   */
  exclude?: string;
  /** What Copy Value copies, when not the label: a path row's host and path */
  value?: string;
  /** What Decrypt in the row's menu decrypts: its host, site or app */
  decrypt?: DecryptSubject;
  /** The saved search a Saved row is, for renaming and deleting it */
  savedId?: string;
  /**
   * On disk: a folder row's working directory, in full, and a program's executable, for Reveal
   * in Finder and, on a folder, Copy path
   */
  path?: string;
}

/** A saved search as the sidebar lists it, with how many flows it covers */
export interface SavedRow {
  id: string;
  name: string;
  query: string;
  count: number;
}

/** The ids of All traffic and the groups */
export const ALL_ID = "all";
export const SAVED_ID = "saved";
export const APPS_ID = "apps";
export const DOMAINS_ID = "domains";
export const SYSTEM_ID = "system";
export const TUNNELLED_ID = "tunnelled";

/** A row a flow sits under, with what makes it, so a rebuild only looks it up */
interface PlaceRow {
  id: string;
  kind: "folder" | "site" | "host" | "path";
  label: string;
  query: string;
  exclude: string;
  value?: string;
  decrypt?: DecryptSubject;
  /** A folder row's working directory, in full */
  path?: string;
}

/**
 * Where a flow sits, parsed once per flow rather than on every rebuild: its site, host and path
 * rows in Domains, and the same rows under its app, below its working directory for a program
 * outside an app that isn't a generic runtime (those are named by their folder instead).
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
  const hostQuery = fieldTerm("host", host);
  const rows: PlaceRow[] = [
    {
      id: `site:${site}`,
      kind: "site",
      label: site,
      query: siteTerm(site),
      exclude: `-${siteTerm(site)}`,
      decrypt: { kind: "site", site },
    },
    {
      id: `host:${host}`,
      kind: "host",
      label: host,
      query: hostQuery,
      exclude: fieldTerm("host", host, true),
      decrypt: { kind: "host", host },
    },
  ];
  let p = "";
  for (const segment of segments) {
    p += `/${segment}`;
    const query = `${hostQuery} ${pathTerm(p)}`;
    rows.push({
      id: `path:${host}${p}`,
      kind: "path",
      label: `/${segment}`,
      query,
      exclude: `-(${query})`,
      value: `${host}${p}`,
    });
  }
  const system = isSystemFlow(flow);
  const appQuery = app == null ? "" : appQueryFor(app, system);
  let appRows: PlaceRow[] = [];
  if (app != null) {
    const folder = runtimeFolderOf(flow) == null ? folderOf(flow) : null;
    if (folder == null) {
      appRows = rows.map((r) => ({
        ...r,
        id: `app:${app}|${r.id}`,
        query: `${appQuery} ${r.query}`,
      }));
    } else {
      const folderId = `app:${app}|cwd:${folder}`;
      const folderQuery = `${appQuery} ${fieldTerm("cwd", folder)}`;
      const folderRow: PlaceRow = {
        id: folderId,
        kind: "folder",
        label: folder,
        query: folderQuery,
        exclude: fieldTerm("cwd", folder, true),
      };
      if (flow.clientCwd != null) folderRow.path = flow.clientCwd;
      appRows = [
        folderRow,
        ...rows.map((r) => ({
          ...r,
          id: `${folderId}|${r.id}`,
          query: `${folderQuery} ${r.query}`,
        })),
      ];
    }
  }
  place = { app, system, rows, appRows };
  places.set(flow, place);
  return place;
}

/**
 * What an app's row writes. A daemon's says `@is:system` too, so selecting it shows its flows
 * while System is hidden from All traffic.
 */
function appQueryFor(app: string, system: boolean): string {
  const query = fieldTerm("app", app);
  return system ? `${fieldTerm("is", "system")} ${query}` : query;
}

/** A program outside an app bundle: its executable, for Reveal in Finder */
function programPath(flow: Flow): string | undefined {
  return flow.clientBundleId == null ? (flow.clientPath ?? undefined) : undefined;
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
      item: {
        id: row.id,
        kind: row.kind,
        label: row.label,
        count: 0,
        query: row.query,
        exclude: row.exclude,
      },
      children: new Map(),
    };
    if (row.value != null) node.item.value = row.value;
    if (row.decrypt != null) node.item.decrypt = row.decrypt;
    if (row.path != null) node.item.path = row.path;
    parent.children.set(row.id, node);
  } else if (node.item.path !== row.path) {
    // Folders of the same name in different places share a row, which then names no one path.
    delete node.item.path;
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

/** By label, a program's working directories before the sites it reached directly */
function byLabel(a: Trie, b: Trie): number {
  const folders = Number(b.item.kind === "folder") - Number(a.item.kind === "folder");
  return folders || collator.compare(a.item.label, b.item.label);
}

function group(id: string, label: string): Trie {
  return { item: { id, kind: "group", label, count: 0, query: "" }, children: new Map() };
}

/**
 * The sidebar: All traffic, then Apps, each app opening to its own sites, hosts and paths, then
 * Domains by site, host and path, then System, macOS's daemons, apart from the apps. A group with
 * nothing in it is left out. Not decrypted, after All traffic, gathers the HTTPS passed through
 * undecrypted, when there is any, and Saved lists the saved searches, each with its count from
 * the database. `total` is All traffic's count: every flow it covers in the database.
 */
export function buildSidebarTree(
  flows: Flow[],
  total: number,
  saved: SavedRow[] = [],
): TreeNode<SidebarItem> {
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
  system.item.query = fieldTerm("is", "system");
  let tunnelled = 0;

  for (const flow of flows) {
    const place = placeOf(flow);
    if (flow.tunnelled) tunnelled++;
    addPlace(domains, place.rows);
    if (place.app == null) continue;
    const parent = place.system ? system : apps;
    const id = `app:${place.app}`;
    let app = parent.children.get(id);
    if (app == null) {
      const folder = runtimeFolderOf(flow);
      const item: SidebarItem = {
        id,
        kind: "app",
        label: flow.clientName ?? place.app,
        count: 0,
        query: appQueryFor(place.app, place.system),
        exclude: fieldTerm("app", place.app, true),
      };
      if (flow.clientName != null) {
        item.decrypt = { kind: "app", name: flow.clientName, bundleId: flow.clientBundleId };
      }
      if (folder != null) item.sublabel = folder;
      if (flow.clientPath != null) item.appPath = flow.clientPath;
      const program = programPath(flow);
      if (program != null) item.path = program;
      app = { item, children: new Map() };
      parent.children.set(id, app);
    } else if (app.item.path !== programPath(flow)) {
      // Programs of the same name in different places share a row, which names no one path.
      delete app.item.path;
    }
    app.item.count++;
    parent.item.count++;
    addPlace(app, place.appRows);
  }
  for (const site of domains.children.values()) domains.item.count += site.children.size;

  root.children?.push({
    item: { id: ALL_ID, kind: "all", label: "All traffic", count: total, query: "" },
    parent: root,
    depth: 1,
    draggable: false,
  });
  if (tunnelled > 0) {
    root.children?.push({
      item: {
        id: TUNNELLED_ID,
        kind: "tunnelled",
        label: "Not decrypted",
        count: tunnelled,
        query: fieldTerm("is", "tunnelled"),
      },
      parent: root,
      depth: 1,
      draggable: false,
    });
  }
  if (saved.length > 0) {
    const node: TreeNode<SidebarItem> = {
      item: { id: SAVED_ID, kind: "group", label: "Saved", count: 0, query: "" },
      parent: root,
      depth: 1,
      children: [],
      draggable: false,
    };
    node.children = saved.map((s) => ({
      item: {
        id: `saved:${s.id}`,
        kind: "saved",
        label: s.name,
        count: s.count,
        query: s.query,
        savedId: s.id,
      },
      parent: node,
      depth: 2,
      draggable: false,
    }));
    root.children?.push(node);
  }
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

/**
 * The search text for the selected rows: their queries, OR'd, one with `OR` of its own in
 * parentheses so it stays one group; empty for All traffic
 */
export function selectionText(items: SidebarItem[]): string {
  const queries = [...new Set(items.map((i) => i.query))];
  if (queries.includes("")) return "";
  return queries.length === 1 ? (queries[0] ?? "") : queries.map(asOneTerm).join(" OR ");
}

/**
 * All traffic is selected alone: chosen beside other rows it takes their place, and another row
 * chosen beside it takes its. `before` is the selection as it was.
 */
export function exclusiveAll(ids: string[], before: string[]): string[] {
  if (!ids.includes(ALL_ID) || ids.length === 1) return ids;
  return before.includes(ALL_ID) ? ids.filter((id) => id !== ALL_ID) : [ALL_ID];
}

/**
 * The rows a filter applied leaves selected: those selected whose query is still in it, and,
 * with `add`, every row whose query is one of its `OR` groups whole, as the filter the rows
 * wrote is when Back returns to it. All traffic alone for no filter.
 */
export function rowsForFilter(
  text: string,
  selected: string[],
  items: Map<string, SidebarItem>,
  add: boolean,
): string[] {
  if (text.trim() === "") return [ALL_ID];
  const rows = selected.filter((id) => {
    const item = items.get(id);
    return item != null && item.query !== "" && queryInText(item.query, text);
  });
  if (!add) return rows;
  const groups = new Set(orGroupShapes(text));
  for (const [id, item] of items) {
    if (item.query === "" || rows.includes(id)) continue;
    const shape = queryShape(item.query);
    if (shape != null && groups.has(shape)) rows.push(id);
  }
  return rows;
}

/**
 * Whether a row's query is still in the search text, every term of it among the text's: a row
 * stays selected while it is, so typing after selecting keeps it.
 */
export function queryInText(query: string, text: string): boolean {
  const have = new Set(termKeys(text));
  const want = termKeys(query);
  if (want.length === 0) return have.size === 0;
  return want.every((t) => have.has(t));
}

/** The rows of a selection whose menu filters by them: apps, folders, sites, hosts and paths */
export function valueRows(items: SidebarItem[]): SidebarItem[] {
  return items.filter((i) => i.exclude != null);
}

/**
 * The filter `text` with the rows added, for Filter by This Value: their queries as one `OR`
 * group, or their values each excluded. A filter with `OR` at its top is grouped first, so the
 * rows narrow all of it, as the list's cell menu does.
 */
export function filterWithRows(text: string, items: SidebarItem[], negated: boolean): string {
  const rows = valueRows(items);
  const terms = [
    ...new Set(rows.map((i) => (negated ? (i.exclude ?? "") : i.query)).filter((t) => t !== "")),
  ];
  if (terms.length === 0) return text;
  const term = negated ? terms.join(" ") : terms.join(" OR ");
  const current = text.trim();
  return current === "" ? term : `${asOneTerm(current)} ${asOneTerm(term)}`;
}

/**
 * What Copy Value copies for the rows, one a line: an app's name, a folder's path, a site or
 * host, or a path's host and path
 */
export function copyRowsText(items: SidebarItem[]): string {
  const values = valueRows(items).map((i) =>
    i.kind === "folder" ? (i.path ?? i.label) : (i.value ?? i.label),
  );
  return [...new Set(values)].join("\n");
}
