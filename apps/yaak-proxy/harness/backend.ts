import type {
  Flow,
  FlowSortKey,
  GetProxyStateResponse,
  SavedQuery,
} from "@yaakapp-internal/proxy-lib";
import { sortFlows } from "../lib/columns";
import { appIconPng, fixtures } from "./fixtures";

/**
 * Dev only: answers the engine's RPCs the harness pages need, from fixtures, so the card and
 * settings render outside the app as they do inside it.
 */
export function installFixtureBackend() {
  const internals = (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> })
    .__TAURI_INTERNALS__;
  // For checking the window as traffic arrives: `__harnessEmit("model_write", payload)`
  (window as unknown as { __harnessEmit: typeof emit }).__harnessEmit = emit;
  internals.transformCallback = (callback: (event: unknown) => void) => {
    const id = callbacks.size + 1;
    callbacks.set(id, callback);
    return id;
  };
  internals.invoke = async (
    cmd: string,
    args?: { cmd?: string; payload?: unknown; event?: string; handler?: number },
  ) => {
    if (cmd === "rpc") return answer(args?.cmd ?? "", args?.payload);
    if (cmd === "plugin:event|listen" && args?.event != null && args.handler != null) {
      listeners.set(args.event, [...(listeners.get(args.event) ?? []), args.handler]);
      return args.handler;
    }
    if (cmd.startsWith("plugin:event|")) return 0;
    // The app menu's Go items, which the harness has none of
    if (cmd === "set_go_menu") return null;
    throw new Error(`Not in the harness: ${cmd}`);
  };
  (
    window as unknown as { __TAURI_OS_PLUGIN_INTERNALS__: Record<string, string> }
  ).__TAURI_OS_PLUGIN_INTERNALS__ = {
    os_type: "macos",
    platform: "macos",
    family: "unix",
    version: "15.0",
    eol: "\n",
  };
}

export const HARNESS_STATE: GetProxyStateResponse = {
  state: "running",
  port: 9090,
  configuredPort: 9090,
  recording: true,
  systemProxyAtLaunch: true,
  httpVersion: "auto",
  captureBodyLimit: 10 * 1024 * 1024,
  traffic: "keep",
  keepTrafficBytes: 2 * 1024 * 1024 * 1024,
  startError: null,
  encrypting: null,
  locked: null,
  otherOwner: null,
};

/** The engine's state as `?status=paused`, `stopped`, `failed` or `cli` asks; recording otherwise */
function harnessState(status: string | null): GetProxyStateResponse {
  const stopped = { ...HARNESS_STATE, state: "stopped" as const, port: null };
  switch (status) {
    case "paused":
      return { ...HARNESS_STATE, recording: false };
    case "stopped":
      return stopped;
    case "failed":
      return { ...stopped, startError: "Port 9090 is in use by another process." };
    case "cli":
      return {
        ...stopped,
        otherOwner: {
          owner: "cli",
          pid: 4242,
          startedAt: new Date().toISOString(),
          proxyPort: 9090,
        },
      };
    default:
      return HARNESS_STATE;
  }
}

/** Callbacks the window registered, by id, and the ids listening to each event */
const callbacks = new Map<number, (event: unknown) => void>();
const listeners = new Map<string, number[]>();

/** Sends an event to the window, as the engine does */
function emit(event: string, payload: unknown = {}) {
  for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload });
}

/** Filters applied, newest first, and saved searches, kept across reloads as the database is */
const HISTORY_KEY = "harness_filter_history";
const SAVED_KEY = "harness_saved_queries";
const LAST_FILTER_KEY = "harness_last_filter";

function stored<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}

function store(key: string, value: unknown[]) {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * A rough stand-in for the engine's search: `@host:`, `@method:` and `@status:` terms, and bare
 * words in the method, URL and status
 */
function matches(flow: Flow, query: string): boolean {
  const host = (() => {
    try {
      return new URL(flow.url).host;
    } catch {
      return flow.url;
    }
  })();
  const text = `${flow.method} ${flow.url} ${flow.status ?? ""}`.toLowerCase();
  // `OR` between groups, as the sidebar writes several rows
  const groups = query.replace(/[()]/g, " ").split(/\s+OR\s+/);
  if (groups.length > 1) return groups.some((g) => matches(flow, g));
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== "")
    .every((term) => {
      const [, field, value = ""] = /^@([a-z.]+):(.*)$/.exec(term) ?? [];
      if (field === "host") return host.toLowerCase().includes(value.replaceAll("*", ""));
      if (field === "method") return flow.method.toLowerCase() === value;
      if (field === "status") return String(flow.status ?? "").startsWith(value.replace(/x+$/, ""));
      return field == null ? text.includes(term) : true;
    });
}

function allFlows(): Flow[] {
  const many = Number(new URLSearchParams(location.search).get("many") ?? 0);
  return (many > 0 ? manyFlows(many) : fixtures.map((f) => f.flow)).map((f, i) => ({
    ...f,
    number: 1401 + i,
  }));
}

function answer(cmd: string, payload: unknown): unknown {
  const req = (payload ?? {}) as Record<string, unknown>;
  switch (cmd) {
    case "get_flows": {
      const ids = new Set(req.ids as string[]);
      return allFlows().filter((f) => ids.has(f.id));
    }
    case "list_filter_history":
      return stored<string>(HISTORY_KEY).map((filter) => ({ filter, appliedAt: "" }));
    case "record_filter": {
      const filter = String(req.filter).trim();
      if (filter === "") return false;
      store(HISTORY_KEY, [filter, ...stored<string>(HISTORY_KEY).filter((f) => f !== filter)]);
      emit("filter_history_changed");
      return true;
    }
    case "delete_filter_history":
      store(
        HISTORY_KEY,
        stored<string>(HISTORY_KEY).filter((f) => f !== req.filter),
      );
      emit("filter_history_changed");
      return true;
    case "clear_filter_history":
      store(HISTORY_KEY, []);
      emit("filter_history_changed");
      return 0;
    // Held by the engine for as long as the app runs; the tab's session here
    case "get_window_places":
      return sessionStorage.getItem("harness_window_places");
    case "set_window_places":
      sessionStorage.setItem("harness_window_places", String(req.places));
      return true;
    case "get_last_filter":
      return localStorage.getItem(LAST_FILTER_KEY) ?? "";
    case "set_last_filter":
      localStorage.setItem(LAST_FILTER_KEY, String(req.filter));
      return true;
    case "list_saved_queries":
      return stored<SavedQuery>(SAVED_KEY);
    case "create_saved_query": {
      const saved = stored<SavedQuery>(SAVED_KEY);
      const query = {
        id: `sq_${saved.length + 1}`,
        name: String(req.name),
        query: String(req.query),
        sortOrder: saved.length,
      };
      store(SAVED_KEY, [...saved, query]);
      emit("saved_queries_changed");
      return query;
    }
    case "count_saved_queries":
      return stored<SavedQuery>(SAVED_KEY).map((s) => ({
        id: s.id,
        count: allFlows().filter((f) => matches(f, s.query)).length,
      }));
    case "watch_query":
      return true;
    case "get_flow_body": {
      // A copy from `?many` reads its original's body
      const id = String(req.flowId).split("~")[0];
      const fixture = fixtures.find((f) => f.flow.id === id);
      if (fixture == null) throw new Error(`No fixture for ${String(req.flowId)}`);
      return req.which === "request" ? fixture.requestBody : fixture.responseBody;
    }
    case "format_body": {
      const text = typeof req.text === "string" ? req.text : "";
      try {
        return JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        return text;
      }
    }
    case "app_icon":
      return appIconPng;
    case "get_proxy_state":
      return harnessState(new URLSearchParams(location.search).get("status"));
    case "get_storage_size":
      return { bytes: 412 * 1024 * 1024 };
    case "ca_status":
      return {
        trusted: true,
        installed: true,
        certPath: "/Users/you/Library/Application Support/app.yaak.proxy/ca.pem",
      };
    case "system_proxy_status":
      return {
        enabled: true,
        port: 9090,
        services: [],
        backend: "helper",
        helper: "enabled",
        supported: true,
      };
    case "get_decrypt_list":
      return {
        entries: [
          { entry: "host:api.stripe.com", builtIn: false },
          { entry: "app:Google Chrome", builtIn: false },
          { entry: "!host:*.apple.com", builtIn: true },
        ],
      };
    case "list_actions":
      // As the engine lists them on macOS
      return {
        actions: [
          [
            { scope: "global", action: "recording_toggle" },
            { label: "Pause or Resume Recording", defaultHotkey: "Meta+R" },
          ],
          [
            { scope: "global", action: "flows_clear" },
            { label: "Clear Flows", defaultHotkey: "Meta+Shift+K" },
          ],
        ],
      };
    case "list_flows": {
      const all = allFlows();
      const query = typeof req.query === "string" ? req.query : "";
      const matching = all.filter((f) => matches(f, query));
      // In a sort's order, as the database lists it, all in one page
      const sort = (req.sort ?? []) as FlowSortKey[];
      const flows = sort.length > 0 ? sortFlows(matching, sort) : matching.reverse();
      const page = req.limit === 0 ? [] : flows;
      return {
        flows: page,
        total: all.length,
        matching: query === "" ? null : matching.length,
        cursor: null,
      };
    }
    case "list_seen":
      return { hosts: [], apps: [] };
    // A few of the engine's fields, so the search box highlights and completes
    case "query_schema":
      return {
        schema: {
          fields: [
            {
              name: "host",
              kind: { type: "text" },
              info: "The request's host",
              example: "@host:api.example.com",
            },
            {
              name: "method",
              kind: { type: "text" },
              info: "GET, POST, …",
              example: "@method:post",
            },
            {
              name: "status",
              kind: { type: "number", units: [] },
              info: "The response's status",
              example: "@status:>=400",
            },
            {
              name: "header",
              kind: { type: "text" },
              map: true,
              info: "A request or response header",
              example: "@header.accept:*json*",
            },
            {
              name: "res.header",
              kind: { type: "text" },
              map: true,
              info: "A response header",
              example: "@res.header.x-cache:hit",
            },
            {
              name: "query",
              kind: { type: "text" },
              map: true,
              info: "A query parameter",
              example: "@query.page:2",
            },
          ],
        },
      };
    // Header and query parameter names, for completing a map's keys
    case "query_values": {
      const path = (payload as { path?: string } | undefined)?.path ?? "";
      if (path.endsWith("header")) return ["x-cache", "x-request-id", "content-type"];
      return path === "query" ? ["expand", "limit"] : [];
    }
    case "validate_query":
      return [];
    default:
      throw new Error(`Not in the harness: ${cmd}`);
  }
}

/**
 * `?many=3000`: the fixtures over and over, a second apart, for checking the list with a lot of
 * traffic. Every fourth has no response yet, and a program runs in a few working folders.
 */
function manyFlows(count: number): Flow[] {
  const start = Date.parse("2026-11-09T09:00:00Z");
  const folders = ["/Users/you/src/yaak", "/Users/you/.codex/worktrees/1a79/yaak", null];
  return Array.from({ length: count }, (_, i) => {
    const base = fixtures[i % fixtures.length]?.flow as Flow;
    const pending = i % 4 === 3;
    return {
      ...base,
      id: `${base.id}~${i}`,
      startedAt: new Date(start + i * 1000).toISOString().replace("Z", ""),
      url:
        i % 7 === 0 ? `${base.url}/a/rather/long/path/segment/${i}?page=${i}&q=search` : base.url,
      status: pending ? null : base.status,
      contentType: pending ? null : base.contentType,
      responseSize: pending ? 0 : base.responseSize,
      elapsedMs: pending ? null : base.elapsedMs,
      clientCwd: base.clientBundleId == null ? (folders[i % folders.length] ?? null) : null,
      // A cache header with a few values and some without, for a column of it to sort
      responseHeaders:
        i % 5 === 4
          ? base.responseHeaders
          : [
              ...base.responseHeaders,
              { name: "X-Cache", value: ["HIT", "miss", "Hit", "EXPIRED"][i % 4] ?? "" },
            ],
    };
  });
}
