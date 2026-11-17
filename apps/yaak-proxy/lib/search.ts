import type { Flow } from "@yaakapp-internal/proxy-lib";
import { getDomain } from "tldts";

/** The folder a program outside an app ran in */
export function folderOf(flow: Pick<Flow, "clientBundleId" | "clientCwd">): string | null {
  if (flow.clientBundleId != null) return null;
  return folderName(flow.clientCwd);
}

/** The last part of a path: `fieldwork` of `/src/fieldwork/` */
function folderName(path: string | null): string | null {
  if (path == null) return null;
  const name =
    path
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() ?? "";
  return name === "" ? null : name;
}

/** Runtimes that run anyone's code, so six rows of `node` say nothing without their folder */
const GENERIC_RUNTIMES = new Set(["node", "python", "bun", "deno", "ruby", "java", "cargo"]);

/** A program outside an app that runs other code: `node`, `python3.12`, `java` */
export function isGenericRuntime(flow: Pick<Flow, "clientBundleId" | "clientName">): boolean {
  if (flow.clientBundleId != null || flow.clientName == null) return false;
  const name = flow.clientName.toLowerCase().replace(/\.exe$/, "");
  return GENERIC_RUNTIMES.has(name.replace(/[\d.]+$/, ""));
}

/**
 * The folder that names a generic runtime's row, `node` in `fieldwork`; null for anything
 * else, whose folders are rows under it
 */
export function runtimeFolderOf(
  flow: Pick<Flow, "clientBundleId" | "clientName" | "clientCwd">,
): string | null {
  return isGenericRuntime(flow) ? folderOf(flow) : null;
}

/**
 * What `@app` names a flow's app by, and what the sidebar groups its apps by: an app's name, a
 * program's name, or for a generic runtime the folder it ran in. Null when unknown.
 */
export function appKeyOf(flow: Flow): string | null {
  return runtimeFolderOf(flow) ?? flow.clientName ?? flow.clientBundleId ?? flow.clientPath;
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
 * helpers, which send apps' traffic. `is_system` in `crates-proxy/yaak-proxy-lib`, which
 * `@is:system` searches by, follows the same rules.
 */
export function isSystemFlow(flow: Pick<Flow, "clientBundleId" | "clientPath">): boolean {
  const path = flow.clientPath;
  if (path == null || flow.clientBundleId != null) return false;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.startsWith("com.apple.WebKit.")) return false;
  return SYSTEM_DIRS.some((dir) => path.startsWith(dir)) || SYSTEM_PROGRAMS.has(name);
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
 * `@host` searches by, follows the same rules.
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
