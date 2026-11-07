import type { DecryptListEntry, SeenTargets } from "@yaakapp-internal/proxy-lib";
import type { FilterOptions } from "@yaakapp-internal/ui/editor";

/**
 * The decrypt list as the engine reads it: `host:` and `app:` entries, `*` for everything, any
 * of them after `!` to exclude. `DecryptEntry` and `DecryptPolicy` in `crates/yaak-proxy`, which
 * decide each connection, follow the same rules; this copy marks the sidebar and the detail.
 */
export const EVERYTHING = "*";

export interface ParsedEntry {
  negated: boolean;
  kind: "everything" | "host" | "app";
  /** A host pattern, lowercased, or an app's name or bundle id as written */
  pattern: string;
  /** The port a host entry is limited to */
  port: number | null;
}

/**
 * An entry as typed: with its prefix, or a bare hostname, which is a `host:` entry. A URL is
 * taken as its host. Null when it is not one.
 */
export function parseEntry(input: string): ParsedEntry | null {
  let rest = input.trim();
  const negated = rest.startsWith("!");
  if (negated) rest = rest.slice(1).trimStart();
  if (rest === "") return null;
  if (rest === EVERYTHING) return { negated, kind: "everything", pattern: "", port: null };
  if (/^app:/i.test(rest)) {
    const app = unquote(rest.slice(4).trim());
    return app === "" ? null : { negated, kind: "app", pattern: app, port: null };
  }
  const host = unquote((/^host:/i.test(rest) ? rest.slice(5) : rest).trim());
  const parsed = parseHost(host);
  return parsed == null ? null : { negated, kind: "host", ...parsed };
}

function unquote(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).trim() : s;
}

function parseHost(input: string): { pattern: string; port: number | null } | null {
  let host = input;
  const scheme = host.indexOf("://");
  if (scheme !== -1) {
    host = host.slice(scheme + 3).split(/[/?#]/)[0] ?? "";
    host = host.slice(host.lastIndexOf("@") + 1);
  }
  let pattern: string;
  let port: number | null = null;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end === -1) return null;
    pattern = host.slice(1, end);
    const after = host.slice(end + 1);
    if (after !== "") {
      if (!after.startsWith(":")) return null;
      port = parsePort(after.slice(1));
      if (port == null) return null;
    }
  } else {
    const colon = host.lastIndexOf(":");
    const name = colon === -1 ? host : host.slice(0, colon);
    // One colon is a port; more, a bare IPv6 address.
    if (colon !== -1 && !name.includes(":")) {
      port = parsePort(host.slice(colon + 1));
      if (port == null) return null;
      pattern = name;
    } else {
      pattern = host;
    }
  }
  pattern = pattern.replace(/\.+$/, "").toLowerCase();
  if (pattern === "" || !/^[a-z0-9\-._*:]+$/.test(pattern)) return null;
  return { pattern, port };
}

function parsePort(s: string): number | null {
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n <= 65535 ? n : null;
}

/** The entry as stored: `host:api.example.com`, `!app:Slack`, `*` */
export function formatEntry(e: ParsedEntry): string {
  const not = e.negated ? "!" : "";
  if (e.kind === "everything") return `${not}${EVERYTHING}`;
  if (e.kind === "app") return `${not}app:${e.pattern}`;
  if (e.port == null) return `${not}host:${e.pattern}`;
  const host = e.pattern.includes(":") ? `[${e.pattern}]` : e.pattern;
  return `${not}host:${host}:${e.port}`;
}

/** An entry as typed, normalized as the engine stores it, or null when it is not one */
export function normalizeEntry(input: string): string | null {
  const parsed = parseEntry(input);
  return parsed == null ? null : formatEntry(parsed);
}

/** How the list names an entry: `*` is Everything, anything else as written */
export function entryLabel(entry: string): string {
  if (entry === EVERYTHING) return "Everything";
  if (entry === `!${EVERYTHING}`) return "Nothing";
  return entry;
}

/** What a connection is: where it goes and, when known, the app that sent it */
export interface DecryptQuery {
  host: string;
  port?: number | null;
  app?: { name: string; bundleId: string | null } | null;
}

function glob(pattern: string, text: string): boolean {
  let pi = 0;
  let ti = 0;
  let star: [number, number] | null = null;
  while (ti < text.length) {
    if (pi < pattern.length && pattern[pi] === "*") {
      star = [pi, ti];
      pi++;
    } else if (pi < pattern.length && pattern[pi] === text[ti]) {
      pi++;
      ti++;
    } else if (star != null) {
      pi = star[0] + 1;
      ti = star[1] + 1;
      star = [star[0], star[1] + 1];
    } else {
      return false;
    }
  }
  return pattern
    .slice(pi)
    .split("")
    .every((c) => c === "*");
}

/** `*.example.com` matches `example.com` too, as the search's `@host` does */
function hostMatches(pattern: string, host: string): boolean {
  const h = host
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();
  return glob(pattern, h) || (pattern.startsWith("*.") && glob(pattern.slice(2), h));
}

function matches(e: ParsedEntry, q: DecryptQuery): boolean {
  switch (e.kind) {
    case "everything":
      return true;
    case "host":
      return (e.port == null || e.port === (q.port ?? 443)) && hostMatches(e.pattern, q.host);
    case "app": {
      if (q.app == null) return false;
      const p = e.pattern.toLowerCase();
      return (
        glob(p, q.app.name.toLowerCase()) ||
        (q.app.bundleId != null && glob(p, q.app.bundleId.toLowerCase()))
      );
    }
  }
}

function specificity(e: ParsedEntry): number {
  if (e.kind === "everything") return 0;
  if (e.kind === "app") return Number.POSITIVE_INFINITY;
  // A site's `*.` counts for nothing, as `*.apple.com` matches `apple.com` itself.
  const pattern = e.pattern.startsWith("*.") ? e.pattern.slice(2) : e.pattern;
  return pattern.replaceAll("*", "").length + (e.port == null ? 0 : 1);
}

/**
 * Whether the list decrypts `q`: a positive entry matches and no negative one does, wherever
 * each sits. A built-in exclusion yields to a positive entry at least as specific as itself.
 */
export function decrypts(list: DecryptListEntry[], q: DecryptQuery): boolean {
  const parsed = list.flatMap((e) => {
    const p = parseEntry(e.entry);
    return p == null ? [] : [{ ...p, builtIn: e.builtIn }];
  });
  let best = -1;
  for (const e of parsed) {
    if (!e.negated && matches(e, q)) best = Math.max(best, specificity(e));
  }
  if (best < 0) return false;
  return !parsed.some((e) => e.negated && matches(e, q) && (!e.builtIn || specificity(e) > best));
}

/** Some entry decrypts something: the list is not only exclusions */
export function decryptsAnything(list: DecryptListEntry[]): boolean {
  return list.some((e) => !e.entry.trim().startsWith("!"));
}

/** What a sidebar row or the detail's buttons decrypt: a host, a site, or an app */
export type DecryptSubject =
  | { kind: "host"; host: string }
  | { kind: "site"; site: string }
  | { kind: "app"; name: string; bundleId: string | null };

/** The entry that names `subject` alone: `host:api.example.com`, `host:*.example.com`, `app:Slack` */
export function subjectEntry(subject: DecryptSubject): string {
  switch (subject.kind) {
    case "host":
      return normalizeEntry(`host:${subject.host}`) ?? `host:${subject.host}`;
    case "site":
      return `host:*.${subject.site.toLowerCase()}`;
    case "app":
      return `app:${subject.name}`;
  }
}

/** The connection a subject stands for, as the list judges it */
export function subjectQuery(subject: DecryptSubject): DecryptQuery {
  switch (subject.kind) {
    case "host": {
      const parsed = parseHost(subject.host);
      return { host: parsed?.pattern ?? subject.host, port: parsed?.port ?? 443 };
    }
    case "site":
      return { host: subject.site };
    case "app":
      // No host matches an empty one, so only `*` and app entries decide.
      return { host: "", app: { name: subject.name, bundleId: subject.bundleId } };
  }
}

/**
 * An exclusion of the user's that matches `q`, which no entry added beats: Decrypt cannot help
 * until it is edited. Null when there is none.
 */
export function blockingExclusion(list: DecryptListEntry[], q: DecryptQuery): string | null {
  for (const e of list) {
    if (e.builtIn) continue;
    const parsed = parseEntry(e.entry);
    if (parsed?.negated && matches(parsed, q)) return e.entry;
  }
  return null;
}

/**
 * What keeps Decrypt on `subject` from working: an exclusion of the user's that matches it,
 * other than its own exact one, which Decrypt removes. Null when Decrypt works.
 */
export function blockerOf(list: DecryptListEntry[], subjects: DecryptSubject[]): string | null {
  const own = new Set(subjects.map((s) => `!${subjectEntry(s)}`));
  const rest = list.filter((e) => !own.has(e.entry));
  for (const subject of subjects) {
    const blocker = blockingExclusion(rest, subjectQuery(subject));
    if (blocker != null) return blocker;
  }
  return null;
}

/** The list decrypts `subject`'s connections, as its sidebar row marks it */
export function isDecrypted(list: DecryptListEntry[], subject: DecryptSubject): boolean {
  return decrypts(list, subjectQuery(subject));
}

/**
 * The entries after Decrypt or Stop Decrypting on `subject`, to save whole. Decrypt drops an
 * exclusion of the subject the user added, then adds its entry if it is still not decrypted.
 * Stop drops its entry, then excludes it if something broader, `*` say, still decrypts it.
 */
export function toggleDecrypt(list: DecryptListEntry[], subject: DecryptSubject): string[] {
  return setDecrypted(list, [subject], !isDecrypted(list, subject)).map((e) => e.entry);
}

/**
 * The list with every one of `subjects` decrypted (`on`) or not, each as [`toggleDecrypt`]
 * changes it, those already so left alone: several sidebar rows at once.
 */
export function setDecrypted(
  list: DecryptListEntry[],
  subjects: DecryptSubject[],
  on: boolean,
): DecryptListEntry[] {
  let next = list;
  for (const subject of subjects) {
    if (isDecrypted(next, subject) === on) continue;
    const entry = subjectEntry(subject);
    const drop = on ? `!${entry}` : entry;
    next = next.filter((e) => e.builtIn || e.entry !== drop);
    if (isDecrypted(next, subject) === on) continue;
    // Something the user excluded more broadly still keeps it out; adding would change nothing.
    if (on && blockingExclusion(next, subjectQuery(subject)) != null) continue;
    const add = on ? entry : `!${entry}`;
    next = [...next.filter((e) => !e.builtIn), { entry: add, builtIn: false }, ...builtIns(next)];
  }
  return next;
}

/**
 * The sidebar menu's row for the selected rows that can be decrypted: Stop Decrypting when every
 * one of them is, else Decrypt. Null when none can.
 */
export function decryptMenuAction(
  list: DecryptListEntry[],
  subjects: DecryptSubject[],
): { label: "Decrypt" | "Stop Decrypting"; on: boolean } | null {
  if (subjects.length === 0) return null;
  const on = !subjects.every((s) => isDecrypted(list, s));
  return { label: on ? "Decrypt" : "Stop Decrypting", on };
}

function builtIns(list: DecryptListEntry[]): DecryptListEntry[] {
  return list.filter((e) => e.builtIn);
}

/** The entries with `entry` added after the user's own, unless it is there already */
export function withEntry(list: DecryptListEntry[], entry: string): string[] {
  const entries = list.map((e) => e.entry);
  if (entries.includes(entry)) return entries;
  const user = list.filter((e) => !e.builtIn).map((e) => e.entry);
  return [...user, entry, ...builtIns(list).map((e) => e.entry)];
}

/** The entries without `entry` */
export function withoutEntry(list: DecryptListEntry[], entry: string): string[] {
  return list.filter((e) => e.entry !== entry).map((e) => e.entry);
}

/** Whether the list decrypts everything, as the first-run card's choice reads it */
export function decryptsEverything(list: DecryptListEntry[]): boolean {
  return list.some((e) => e.entry === EVERYTHING);
}

/** The entries with `*` added or taken out */
export function withEverything(list: DecryptListEntry[], on: boolean): string[] {
  return on ? withEntry(list, EVERYTHING) : withoutEntry(list, EVERYTHING);
}

/**
 * What the list's input suggests: `host:`, `app:` and `!` to start an entry; after `host:` the
 * hosts seen in the capture, after `app:` the apps seen, by name and bundle id.
 */
export function decryptFilterOptions(seen: SeenTargets | null | undefined): FilterOptions {
  const apps = new Set<string>();
  for (const app of seen?.apps ?? []) {
    apps.add(app.name);
    if (app.bundleId != null) apps.add(app.bundleId);
  }
  return {
    fieldPrefix: "",
    replaceValueOnly: true,
    negation: { prefix: "!", info: "Exclude" },
    fields: [
      { name: "host", values: seen?.hosts ?? [], info: "Host or *.site" },
      { name: "app", values: [...apps], info: "App name or bundle id" },
    ],
  };
}
