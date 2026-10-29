import type { Flow, FlowFilter } from "@yaakapp-internal/proxy-lib";

/**
 * A search over every flow in the database: the search box's terms and the sidebar's selection,
 * as `list_flows` takes them.
 */
export type FlowQuery = Pick<FlowFilter, "q" | "under" | "app">;

/** The sidebar node for all of an app's flows */
export function appNodeId(key: string): string {
  return `app:${key}`;
}

/** What groups an app's flows: its bundle id, or its path for a process outside an app */
export function appKeyOf(flow: Flow): string | null {
  return flow.clientBundleId ?? flow.clientPath;
}

/**
 * The sidebar's selection as a query: hosts and paths under `under`, apps under `app`. Null when
 * the selection holds every flow.
 */
export function selectionQuery(selectedIds: string[]): FlowQuery | null {
  const under: string[] = [];
  const app: string[] = [];
  for (const id of selectedIds) {
    if (id === "root" || id === "domains" || id === "apps") return null;
    if (id.startsWith("domain:")) under.push(id.slice("domain:".length));
    else if (id.startsWith("path:")) under.push(id.slice("path:".length));
    else if (id.startsWith("app:")) app.push(id.slice("app:".length));
  }
  if (under.length === 0 && app.length === 0) return null;
  return {
    ...(under.length > 0 ? { under } : {}),
    ...(app.length > 0 ? { app } : {}),
  };
}

/**
 * Whether `flow` is one `query` covers, as `list_flows` decides it in SQL, so new traffic joins a
 * search as it arrives. Every term must match the URL, the method, the status or the content type.
 */
export function matchesQuery(flow: Flow, query: FlowQuery): boolean {
  for (const term of (query.q ?? "").toLowerCase().split(/\s+/)) {
    if (term === "") continue;
    const matched =
      flow.url.toLowerCase().includes(term) ||
      flow.method.toLowerCase() === term ||
      (flow.contentType?.toLowerCase().includes(term) ?? false) ||
      matchesStatus(flow.status, term);
    if (!matched) return false;
  }
  if (query.under != null && !query.under.some((node) => isUnder(flow.url, node))) return false;
  if (query.app != null) {
    const key = appKeyOf(flow);
    if (key == null || !query.app.includes(key)) return false;
  }
  return true;
}

/** `404` exactly, `40` as the start of one, or a class such as `4xx` */
function matchesStatus(status: number | null, term: string): boolean {
  if (status == null) return false;
  const klass = /^([1-9])xx$/.exec(term);
  if (klass != null) return Math.trunc(status / 100) === Number(klass[1]);
  if (!/^\d{1,3}$/.test(term)) return false;
  return term.length === 3 ? status === Number(term) : String(status).startsWith(term);
}

/**
 * The URL is the host or path `node` names, or something below it. The host matches in any
 * case, as the sidebar lowercases it; the path as written.
 */
function isUnder(url: string, node: string): boolean {
  const slash = node.indexOf("/");
  const host = slash === -1 ? node : node.slice(0, slash);
  const path = slash === -1 ? "" : node.slice(slash);
  for (const scheme of ["http://", "https://"]) {
    const origin = scheme + host;
    if (url.slice(0, origin.length).toLowerCase() !== origin.toLowerCase()) continue;
    if (url.slice(origin.length, origin.length + path.length) !== path) continue;
    const prefix = origin + path;
    const next = url.charAt(prefix.length);
    if (next === "" || next === "/" || next === "?" || next === "#") return true;
    // A host's flows on another port sit under it too.
    if (next === ":" && !node.includes("/") && !node.includes(":")) return true;
  }
  return false;
}

/** The search box's text as terms for `list_flows`, or null when it has none */
export function searchTerms(text: string): string | null {
  const q = text.trim().replace(/\s+/g, " ");
  return q === "" ? null : q;
}
