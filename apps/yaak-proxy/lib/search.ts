import type { Flow, FlowFilter } from "@yaakapp-internal/proxy-lib";
import { getDomain } from "tldts";

/**
 * A search over every flow in the database: the search box's terms, its field terms, and
 * whether System's flows are hidden, as `list_flows` takes them.
 */
export type FlowQuery = Pick<FlowFilter, "q" | "under" | "app" | "system" | "tunnelled" | "any">;

/** A word of the search box: a free term, or `@field:value`, maybe negated with `-` */
export interface SearchToken {
  field: string | null;
  value: string;
  negated: boolean;
}

/**
 * The search box's words. Values may be quoted, `@app:"Google Chrome"`; `OR` and `AND` between
 * words are dropped here, and [`clausesOf`] splits on `OR`.
 */
export function tokenize(text: string): SearchToken[] {
  return clausesOf(text).flat();
}

/**
 * The search box's words in the clauses `OR` separates, each a group of terms that must all
 * match: `@app:Slack @host:a.com OR @app:Chrome @host:b.com` is two. `AND` is dropped, since
 * terms side by side must all match anyway.
 */
export function clausesOf(text: string): SearchToken[][] {
  const clauses: SearchToken[][] = [[]];
  const re = /(-)?(?:@([a-z]+):)?(?:"([^"]*)"?|(\S+))/gi;
  for (const m of text.matchAll(re)) {
    const [, minus, field, quoted, bare] = m;
    const value = quoted ?? bare ?? "";
    if (field == null && minus == null && quoted == null && value === "OR") {
      clauses.push([]);
      continue;
    }
    if (field == null && minus == null && quoted == null && value === "AND") continue;
    if (field == null && value === "" && quoted == null) continue;
    clauses.at(-1)?.push({ field: field?.toLowerCase() ?? null, value, negated: minus != null });
  }
  return clauses.filter((c) => c.length > 0);
}

/** `@field:value`, quoting a value with spaces or quotes in it */
export function formatFieldFilter(field: string, value: string, negated = false): string {
  const v = /[\s"]/.test(value) || value === "" ? `"${value.replaceAll('"', "")}"` : value;
  return `${negated ? "-" : ""}@${field}:${v}`;
}

/**
 * The search box's text as a query, or null when it narrows nothing. Clauses `OR` separates are
 * groups, each judged whole, so two sidebar rows under different apps match what each does and
 * not every pairing of their apps and hosts. Within a clause, `@app` terms match any of their
 * apps; `@host` terms any of their hosts, each with the `@path` terms after it; `@is:system`
 * keeps only macOS's daemons and `-@is:system` drops them, as hiding System does when the
 * clause says neither. `@is:tunnelled` keeps only HTTPS passed through undecrypted, and
 * `-@is:tunnelled` drops it. Other words match the URL, the method, the status or the type.
 */
export function parseSearch(text: string, hideSystem = false): FlowQuery | null {
  const clauses = clausesOf(text);
  if (clauses.length <= 1) return parseClause(clauses[0] ?? [], hideSystem);
  const any: FlowQuery[] = [];
  for (const clause of clauses) {
    const group = parseClause(clause, hideSystem);
    // A clause that narrows nothing takes in every flow, so the whole does too.
    if (group == null) return hideSystem ? { system: false } : null;
    any.push(group);
  }
  return { any };
}

function parseClause(tokens: SearchToken[], hideSystem: boolean): FlowQuery | null {
  const words: string[] = [];
  const apps: string[] = [];
  // Each host with the paths written after it.
  const hosts: { host: string; paths: string[] }[] = [];
  let system: boolean | undefined = hideSystem ? false : undefined;
  let tunnelled: boolean | undefined;
  for (const t of tokens) {
    if (t.field === "app" && !t.negated && t.value !== "") apps.push(t.value);
    else if (t.field === "host" && !t.negated && t.value !== "") {
      hosts.push({ host: t.value.replace(/\/+$/, ""), paths: [] });
    } else if (t.field === "path" && !t.negated && t.value !== "") {
      const path = t.value.replace(/\/?\*$/, "").replace(/^\/+/, "");
      const host = hosts.at(-1);
      // A path with no host to sit under matches anywhere in the URL.
      if (host == null) {
        if (path !== "") words.push(`/${path}`);
      } else {
        host.paths.push(path);
      }
    } else if (t.field === "is" && t.value.toLowerCase() === "system") system = !t.negated;
    else if (t.field === "is" && t.value.toLowerCase() === "tunnelled") tunnelled = !t.negated;
    else if (t.field == null && !t.negated) words.push(t.value);
    // Fields and exclusions the query language will add are ignored until it lands.
  }
  const under: string[] = [];
  for (const { host, paths } of hosts) {
    if (paths.length === 0 || host.startsWith("*.")) under.push(host);
    else for (const p of paths) under.push(p === "" ? host : `${host}/${p}`);
  }
  const q = words.join(" ").trim();
  const query: FlowQuery = {
    ...(q === "" ? {} : { q }),
    ...(under.length > 0 ? { under } : {}),
    ...(apps.length > 0 ? { app: apps } : {}),
    ...(system == null ? {} : { system }),
    ...(tunnelled == null ? {} : { tunnelled }),
  };
  return Object.keys(query).length === 0 ? null : query;
}

/**
 * Wider searches for one that matched nothing: the text with each of its terms left out in turn,
 * without repeats. With groups `OR` separates, a term is left out of one group at a time and
 * the groups kept, since each group alone is narrower still; a group left with nothing would
 * take in every flow, so it is not offered.
 */
export function widerQueries(text: string): string[] {
  const format = (t: SearchToken) =>
    t.field == null
      ? `${t.negated ? "-" : ""}${/\s/.test(t.value) ? `"${t.value}"` : t.value}`
      : formatFieldFilter(t.field, t.value, t.negated);
  const clauses = clausesOf(text).map((c) => c.map(format));
  const out = new Set<string>();
  clauses.forEach((clause, i) => {
    if (clause.length <= 1) return;
    clause.forEach((_, j) => {
      const wider = clauses.map((c, k) => (k === i ? c.filter((_, l) => l !== j) : c));
      out.add(wider.map((c) => c.join(" ")).join(" OR "));
    });
  });
  return [...out];
}

/** The folder a program outside an app ran in, which names it better than its executable */
export function folderOf(flow: Pick<Flow, "clientBundleId" | "clientCwd">): string | null {
  if (flow.clientBundleId != null || flow.clientCwd == null) return null;
  const name = flow.clientCwd.replace(/\/+$/, "").split("/").pop() ?? "";
  return name === "" ? null : name;
}

/**
 * What `@app` names a flow's app by, and what the sidebar groups its apps by: an app's name, or
 * for a program outside an app the folder it ran in, else its name. Null when unknown.
 */
export function appKeyOf(flow: Flow): string | null {
  return folderOf(flow) ?? flow.clientName ?? flow.clientBundleId ?? flow.clientPath;
}

const SYSTEM_DIRS = ["/System/", "/usr/libexec/", "/usr/sbin/", "/sbin/", "/Library/Apple/"];
const SYSTEM_PROGRAMS = new Set([
  "akd",
  "apsd",
  "cloudd",
  "mDNSResponder",
  "nsurlsessiond",
  "ocspd",
  "softwareupdated",
  "trustd",
]);

/**
 * A flow from one of macOS's own daemons: a process outside an app bundle whose executable is
 * under `/System`, `/usr/libexec` and the like, or one of a few daemons by name, but not WebKit's
 * helpers, which send apps' traffic. `is_system` in `crates-proxy/yaak-proxy-lib`, which the
 * database filters by, follows the same rules.
 */
export function isSystemFlow(flow: Pick<Flow, "clientBundleId" | "clientPath">): boolean {
  const path = flow.clientPath;
  if (path == null || flow.clientBundleId != null) return false;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.startsWith("com.apple.WebKit.")) return false;
  return SYSTEM_DIRS.some((dir) => path.startsWith(dir)) || SYSTEM_PROGRAMS.has(name);
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
  if (query.app != null && !query.app.some((app) => matchesApp(flow, app))) return false;
  if (query.system != null && isSystemFlow(flow) !== query.system) return false;
  if (query.tunnelled != null && flow.tunnelled !== query.tunnelled) return false;
  // One of the groups, each judged whole, as the database judges them.
  if (query.any != null && query.any.length > 0) {
    return query.any.some((group) => matchesQuery(flow, group));
  }
  return true;
}

/** By bundle id or path exactly, or by name or folder in any case */
function matchesApp(flow: Flow, app: string): boolean {
  if ((flow.clientBundleId ?? flow.clientPath) === app) return true;
  const lower = app.toLowerCase();
  return flow.clientName?.toLowerCase() === lower || folderOf(flow)?.toLowerCase() === lower;
}

/** `404` exactly, `40` as the start of one, or a class such as `4xx` */
function matchesStatus(status: number | null, term: string): boolean {
  if (status == null) return false;
  const klass = /^([1-9])xx$/.exec(term);
  if (klass != null) return Math.trunc(status / 100) === Number(klass[1]);
  if (!/^\d{1,3}$/.test(term)) return false;
  return term.length === 3 ? status === Number(term) : String(status).startsWith(term);
}

/** The URL is the host or path `node` names, or something below it, by the sidebar's rules */
function isUnder(url: string, node: string): boolean {
  const path = sidebarPath(url);
  if (node.startsWith("*.") && !node.includes("/")) {
    const site = node.slice(2).toLowerCase();
    const host = hostnameOf(path.split("/")[0] ?? "");
    return host === site || host.endsWith(`.${site}`);
  }
  const want = normalizeNode(node);
  return path === want || path.startsWith(`${want}/`);
}

/** A host without its port, keeping an IPv6 address's brackets */
export function hostnameOf(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.lastIndexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

const sites = new Map<string, string>();

/**
 * The site a host belongs to, its registrable domain by the public suffix list: `github.com` for
 * `api.github.com`, `example.co.uk` for `www.example.co.uk`. An address or a name with no public
 * suffix, such as `localhost`, is its own site.
 */
export function siteOf(host: string): string {
  let site = sites.get(host);
  if (site == null) {
    const name = hostnameOf(host);
    site = getDomain(name, { allowPrivateDomains: true }) ?? name;
    sites.set(host, site);
  }
  return site;
}

/**
 * Where the sidebar places a URL: its host, lowercased and without its scheme's default port,
 * then its path's non-empty segments, joined by `/`, as in `api.stripe.com/v1/charges`. A URL
 * without a scheme is a host of its own. `sidebar_path` in `crates-proxy/yaak-proxy-lib`, which
 * the database filters by, follows the same rules.
 */
export function sidebarPath(url: string): string {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) return url;
  const scheme = url.slice(0, schemeEnd).toLowerCase();
  const rest = url.slice(schemeEnd + 3);
  const authorityEnd = rest.search(/[/?#]/);
  let host = (authorityEnd === -1 ? rest : rest.slice(0, authorityEnd)).toLowerCase();
  const defaultPort =
    scheme === "http" || scheme === "ws"
      ? ":80"
      : scheme === "https" || scheme === "wss"
        ? ":443"
        : null;
  if (defaultPort != null && host.endsWith(defaultPort)) {
    host = host.slice(0, -defaultPort.length);
  }
  const path = authorityEnd === -1 ? "" : (rest.slice(authorityEnd).split(/[?#]/)[0] ?? "");
  const segments = path.split("/").filter((s) => s !== "");
  return [host, ...segments].join("/");
}

/** A sidebar node as `sidebarPath` writes it, its host lowercased */
function normalizeNode(node: string): string {
  const slash = node.indexOf("/");
  return slash === -1
    ? node.toLowerCase()
    : `${node.slice(0, slash).toLowerCase()}${node.slice(slash)}`;
}
