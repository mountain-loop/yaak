import type { Flow, GetProxyStateResponse } from "@yaakapp-internal/proxy-lib";
import { fixtures } from "./fixtures";

/**
 * Dev only: answers the engine's RPCs the harness pages need, from fixtures, so the card and
 * settings render outside the app as they do inside it.
 */
export function installFixtureBackend() {
  const internals = (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> })
    .__TAURI_INTERNALS__;
  internals.invoke = async (cmd: string, args?: { cmd?: string; payload?: unknown }) => {
    if (cmd === "rpc") return answer(args?.cmd ?? "", args?.payload);
    if (cmd.startsWith("plugin:event|")) return 0;
    throw new Error(`Not in the harness: ${cmd}`);
  };
  (window as unknown as { __TAURI_OS_PLUGIN_INTERNALS__: Record<string, string> })
    .__TAURI_OS_PLUGIN_INTERNALS__ = {
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

function answer(cmd: string, payload: unknown): unknown {
  const req = (payload ?? {}) as Record<string, unknown>;
  switch (cmd) {
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
      return null;
    case "get_proxy_state":
      return HARNESS_STATE;
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
      return { actions: [] };
    case "list_flows": {
      const many = Number(new URLSearchParams(location.search).get("many") ?? 0);
      const flows = (many > 0 ? manyFlows(many) : fixtures.map((f) => f.flow))
        .map((f, i) => ({ ...f, number: 1401 + i }))
        .reverse();
      return { flows, total: flows.length, matching: null };
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
          ],
        },
      };
    case "query_values":
      return [];
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
    };
  });
}
