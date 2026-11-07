import type { GetProxyStateResponse } from "@yaakapp-internal/proxy-lib";
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
      const fixture = fixtures.find((f) => f.flow.id === req.flowId);
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
      const flows = fixtures.map((f, i) => ({ ...f.flow, number: 1401 + i })).reverse();
      return { flows, total: flows.length, matching: null };
    }
    case "list_seen":
      return { hosts: [], apps: [] };
    default:
      throw new Error(`Not in the harness: ${cmd}`);
  }
}
