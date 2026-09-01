/**
 * The command table: what this host answers, and what it declines and why.
 *
 * The model commands are forwarded to the worker, where the desktop's own
 * model layer answers them — same queries, same migrations, same cascade
 * rules — so nothing about *what a model is* is decided in this file. What is
 * decided here is the rest of the desktop's command surface: a handful of
 * fixed answers that are true of a browser tab, and the refusals. The refusals
 * are the important half: a command that silently returns nothing leaves the
 * UI showing something that isn't true, whereas a refusal with a reason becomes
 * a toast the user can act on. So each unsupported command is listed by name
 * with the reason, and anything not listed at all is refused generically
 * rather than guessed at.
 *
 * The command names are `keyof RpcSchema`, the same generated wire schema the
 * desktop's router is built from, so a command renamed or added in Rust shows
 * up here as a type error rather than as a runtime surprise.
 */

import type { RpcSchema } from "@yaakapp-internal/rpc-schema";
import type { CapabilityName, RpcPayload } from "../types";
import type { WorkerConnection } from "./connection";
import { unsupported } from "./errors";
import { sendHttpRequest } from "./send";

export type AppCmd = keyof RpcSchema;

type Handler = (payload: RpcPayload, db: WorkerConnection) => Promise<unknown>;

/** Placeholder shown wherever the desktop would show a real filesystem path. */
const NO_PATH = "";

function str(payload: RpcPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** Like `str`, but for fields where an empty string is a legitimate value. */
function text(payload: RpcPayload, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

/**
 * Commands this host answers itself.
 *
 * Anything here either reads and writes the browser's own database, or is a
 * fixed answer that is true of this host — not a stub standing in for something
 * that should work.
 */
const HANDLERS: Partial<Record<AppCmd, Handler>> = {
  /* ------------------------------- models -------------------------------- */

  // Answered by the model layer itself, in the worker. The payload goes over
  // untouched and the answer comes back untouched: this file has no opinion
  // about models, and it would be wrong for it to grow one.
  models_workspace_models: (payload, db) => db.rpc("models_workspace_models", payload),
  models_upsert: (payload, db) => db.rpc("models_upsert", payload),
  models_delete: (payload, db) => db.rpc("models_delete", payload),
  models_duplicate: (payload, db) => db.rpc("models_duplicate", payload),
  models_get_settings: (payload, db) => db.rpc("models_get_settings", payload),
  models_get_graphql_introspection: (payload, db) =>
    db.rpc("models_get_graphql_introspection", payload),
  models_upsert_graphql_introspection: (payload, db) =>
    db.rpc("models_upsert_graphql_introspection", payload),
  models_grpc_events: (payload, db) => db.rpc("models_grpc_events", payload),
  models_websocket_events: (payload, db) => db.rpc("models_websocket_events", payload),
  cmd_get_workspace_meta: (payload, db) => db.rpc("cmd_get_workspace_meta", payload),
  cmd_delete_all_http_responses: (payload, db) => db.rpc("cmd_delete_all_http_responses", payload),
  cmd_delete_send_history: (payload, db) => db.rpc("cmd_delete_send_history", payload),

  /* ------------------------------- sending ------------------------------- */

  // The tab renders and stores; a stateless server puts the bytes on the wire.
  // See send.ts for the whole shape of it.
  cmd_send_http_request: (payload, db) => {
    const requestId = str(payload, "requestId");
    if (requestId == null) throw new Error("cmd_send_http_request needs a requestId");
    return sendHttpRequest(db, requestId, str(payload, "environmentId"), str(payload, "cookieJarId"));
  },

  /* -------------------------------- app ---------------------------------- */

  async cmd_metadata() {
    return {
      isDev: true,
      version: "0.0.0-web",
      cliVersion: null,
      name: "Yaak",
      // The desktop hands out real directories here and the UI offers to open
      // them. There is no filesystem behind this host, and the capability flags
      // are what the UI should be gating those affordances on.
      appDataDir: NO_PATH,
      appLogDir: NO_PATH,
      vendoredPluginDir: NO_PATH,
      defaultProjectDir: NO_PATH,
      featureUpdater: false,
      featureLicense: false,
    };
  },

  // The theme package ships its own defaults, so an empty list is a complete
  // answer rather than a degraded one — themes beyond those come from plugins.
  async cmd_get_themes() {
    return [];
  },

  async cmd_default_headers() {
    // Mirrors `default_headers()` in crates/yaak-models/src/queries/workspaces.rs
    return [
      { enabled: true, name: "User-Agent", value: "yaak", id: null },
      { enabled: true, name: "Accept", value: "*/*", id: null },
    ];
  },

  async cmd_plugin_init_errors() {
    return [];
  },

  async cmd_check_for_updates() {
    return false;
  },

  async cmd_dismiss_notification() {
    return null;
  },

  // Plugin-contributed menus. Empty is honest: no plugin runtime, no actions.
  async cmd_http_request_actions() {
    return [];
  },
  async cmd_websocket_request_actions() {
    return [];
  },
  async cmd_grpc_request_actions() {
    return [];
  },
  async cmd_workspace_actions() {
    return [];
  },
  async cmd_folder_actions() {
    return [];
  },

  /**
   * Both of these are polled once a second until they answer with something, so
   * an empty list is not a quiet no — it is a poll that never stops.
   *
   * The auth list names what Yaak actually offers, so the picker tells the
   * truth about the product even though the form behind each entry stays empty
   * until plugins run here. Template functions get the opposite treatment: one
   * provider contributing no functions. That settles the poll while putting
   * nothing in the autocomplete, which is the honest answer — a function the
   * user could insert but nothing could evaluate would be worse than none.
   */
  async cmd_get_http_authentication_summaries() {
    return HTTP_AUTHENTICATION_SUMMARIES;
  },
  async cmd_template_function_summaries() {
    return [{ pluginRefId: "web", functions: [] }];
  },

  async cmd_get_http_authentication_config() {
    return { args: [], pluginRefId: "web" };
  },

  async cmd_format_json(payload) {
    const source = text(payload, "text");
    try {
      return JSON.stringify(JSON.parse(source), null, 2);
    } catch {
      // Formatting invalid JSON is a no-op, not an error: the editor calls this
      // while the user is still typing.
      return source;
    }
  },

  /**
   * Rendering resolves variables and calls template functions, and the
   * functions live in plugins. Handing the template back unrendered is what the
   * preview then shows — the raw `${[...]}`, which is at least the thing the
   * user typed rather than a wrong value.
   */
  async cmd_render_template(payload) {
    return text(payload, "template");
  },

  /* ------------------------------- bodies -------------------------------- */

  async cmd_http_response_body(payload, db) {
    const responseId = str(payload, "responseId");
    if (responseId == null) return { content: "" };

    if (str(payload, "filter") != null) {
      return {
        content: "",
        error: "Response filters come from a plugin, which this host doesn't run yet",
      };
    }

    const bytes = await db.blobGet(responseId);
    return { content: bytes == null ? "" : new TextDecoder().decode(bytes) };
  },

  // Bodies live in this database, not on a disk, so there is no path to give.
  async cmd_http_response_body_path() {
    return null;
  },

  async cmd_http_request_body(payload, db) {
    const responseId = str(payload, "responseId");
    if (responseId == null) return null;
    // Keyed the way the desktop keys it: the request bytes belong to the
    // response that recorded them.
    const bytes = await db.blobGet(`${responseId}.request`);
    return bytes == null ? null : Array.from(bytes);
  },

  // The rows the sender wrote for that response, same table as the desktop.
  cmd_get_http_response_events: (payload, db) => db.rpc("cmd_get_http_response_events", payload),

  async cmd_get_sse_events() {
    return [];
  },
};

/**
 * The auth methods Yaak ships as plugins today (plugins/auth-*). Listed so the
 * picker is truthful about the product; choosing one currently yields an empty
 * config form, because the plugin that defines the form isn't running.
 */
const HTTP_AUTHENTICATION_SUMMARIES = [
  { name: "apikey", label: "API Key", shortLabel: "API Key" },
  { name: "aws", label: "AWS SigV4", shortLabel: "AWS" },
  { name: "basic", label: "Basic Auth", shortLabel: "Basic" },
  { name: "bearer", label: "Bearer Token", shortLabel: "Bearer" },
  { name: "jwt", label: "JWT Bearer", shortLabel: "JWT" },
  { name: "ntlm", label: "NTLM", shortLabel: "NTLM" },
  { name: "oauth1", label: "OAuth 1.0", shortLabel: "OAuth 1" },
  { name: "oauth2", label: "OAuth 2.0", shortLabel: "OAuth 2" },
];

/**
 * Commands this host declines, each with the reason a user would need.
 *
 * Naming them individually rather than letting them fall through to a generic
 * refusal is deliberate: "sending is not available yet" and "Yaak in a browser
 * has no filesystem" are different situations, and the second is permanent
 * while the first is a slice away.
 */
const DECLINED: Partial<Record<AppCmd, [reason: string, capability: CapabilityName | null]>> = {
  // Saved requests send through the server (see send.ts). Ephemeral sends — the
  // ones nothing stores, used for GraphQL introspection — take the same road but
  // return the body inline; not wired yet.
  cmd_send_ephemeral_request: ["Sending unsaved requests isn't available in the browser yet", null],
  cmd_curl_to_request: ["Importing from cURL needs a plugin, which this host doesn't run", null],

  // Protocols that need a real socket.
  cmd_grpc_reflect: ["gRPC isn't available in the browser", "grpc"],
  cmd_grpc_go: ["gRPC isn't available in the browser", "grpc"],
  cmd_delete_all_grpc_connections: ["gRPC isn't available in the browser", "grpc"],
  cmd_ws_connect: ["WebSocket requests aren't available in the browser yet", "websocket"],
  cmd_ws_send: ["WebSocket requests aren't available in the browser yet", "websocket"],
  cmd_ws_close: ["WebSocket requests aren't available in the browser yet", "websocket"],
  cmd_ws_delete_connections: ["WebSocket requests aren't available in the browser yet", "websocket"],

  // Anything that needs files the page can't reach.
  cmd_import_data: ["Importing from a file needs a filesystem, which a browser tab has no", "localFiles"],
  cmd_import_url: ["Importing from a URL needs the Yaak server, which isn't available yet", null],
  cmd_commit_import: ["Importing needs a plugin, which this host doesn't run", null],
  cmd_list_import_sources: ["Importing isn't available in the browser yet", null],
  cmd_import_sources_for_origin: ["Importing isn't available in the browser yet", null],
  cmd_export_data: ["Exporting to a file isn't available in the browser yet", "localFiles"],
  cmd_save_response: ["Saving a response to disk isn't available in the browser", "localFiles"],
  cmd_save_base64_to_binary: ["Saving to disk isn't available in the browser", "localFiles"],
  cmd_format_graphql: ["Formatting GraphQL needs a plugin, which this host doesn't run", null],

  // Windows. A tab is the window, and there is only ever one of it.
  cmd_new_child_window: ["Yaak in a browser uses one tab", "multiWindow"],
  cmd_new_main_window: ["Yaak in a browser uses one tab", "multiWindow"],
  cmd_restart: ["Reload the page to restart Yaak", null],

  // Workspace encryption is backed by a key the host keeps for you; a page has
  // nowhere to keep one that a page couldn't also read.
  cmd_enable_encryption: ["Workspace encryption isn't available in the browser", "encryption"],
  cmd_disable_encryption: ["Workspace encryption isn't available in the browser", "encryption"],
  cmd_reveal_workspace_key: ["Workspace encryption isn't available in the browser", "encryption"],
  cmd_set_workspace_key: ["Workspace encryption isn't available in the browser", "encryption"],
  cmd_secure_template: ["Workspace encryption isn't available in the browser", "encryption"],
  cmd_decrypt_template: ["Workspace encryption isn't available in the browser", "encryption"],

  // The plugin runtime is a Node process. Nothing here runs one.
  cmd_reload_plugins: ["Plugins aren't available in the browser yet", "plugins"],
  cmd_plugin_info: ["Plugins aren't available in the browser yet", "plugins"],
  cmd_plugins_search: ["Plugins aren't available in the browser yet", "plugins"],
  cmd_plugins_install: ["Plugins aren't available in the browser yet", "plugins"],
  cmd_plugins_install_from_directory: ["Plugins aren't available in the browser yet", "plugins"],
  cmd_plugins_uninstall: ["Plugins aren't available in the browser yet", "plugins"],
  cmd_plugins_updates: ["Plugins aren't available in the browser yet", "plugins"],
  cmd_plugins_update_all: ["Plugins aren't available in the browser yet", "plugins"],
  cmd_template_function_config: ["Template functions come from plugins, which this host doesn't run", "plugins"],
  cmd_template_tokens_to_string: ["Template functions come from plugins, which this host doesn't run", "plugins"],
  cmd_call_http_request_action: ["Plugins aren't available in the browser yet", "plugins"],
  cmd_call_websocket_request_action: ["Plugins aren't available in the browser yet", "plugins"],
  cmd_call_grpc_request_action: ["Plugins aren't available in the browser yet", "plugins"],
  cmd_call_workspace_action: ["Plugins aren't available in the browser yet", "plugins"],
  cmd_call_folder_action: ["Plugins aren't available in the browser yet", "plugins"],
  cmd_call_http_authentication_action: ["Plugins aren't available in the browser yet", "plugins"],

  cmd_send_feedback: ["Feedback goes through the desktop app for now", null],
};

/**
 * The support table, for documentation and for the console.
 *
 * Derived from the two maps above rather than written alongside them, so it
 * cannot drift from what the host actually does.
 */
export function commandSupport(): {
  implemented: string[];
  declined: { cmd: string; reason: string; capability: CapabilityName | null }[];
} {
  return {
    implemented: Object.keys(HANDLERS).sort(),
    declined: Object.entries(DECLINED)
      .map(([cmd, [reason, capability]]) => ({ cmd, reason, capability }))
      .sort((a, b) => a.cmd.localeCompare(b.cmd)),
  };
}

export async function runCommand(
  cmd: string,
  payload: RpcPayload,
  db: WorkerConnection,
): Promise<unknown> {
  const handler = HANDLERS[cmd as AppCmd];
  if (handler != null) return handler(payload, db);

  const declined = DECLINED[cmd as AppCmd];
  if (declined != null) throw unsupported(cmd, declined[0], declined[1]);

  // Git and sync land here, along with anything added to the schema since. The
  // message names the command because an unlisted one is a gap in this file,
  // and whoever hits it should be able to see which.
  throw unsupported(cmd, `\`${cmd}\` isn't available when Yaak runs in a browser`);
}
