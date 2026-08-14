import type { RpcPayload } from "@yaakapp-internal/platform";
import { platform } from "@yaakapp-internal/platform";

/**
 * Every backend command the client sends.
 *
 * Listing them keeps typos out and gives us the inventory to check the Rust
 * side against. Once the app's commands move onto `RpcRouter`, this union is
 * replaced by the generated `RpcSchema` and the payload and result types come
 * with it, the way `apps/yaak-proxy/lib/rpc.ts` already works.
 */
type AppCmd =
  | "cmd_call_grpc_request_action"
  | "cmd_call_http_authentication_action"
  | "cmd_call_http_request_action"
  | "cmd_call_websocket_request_action"
  | "cmd_call_workspace_action"
  | "cmd_call_folder_action"
  | "cmd_check_for_updates"
  | "cmd_curl_to_request"
  | "cmd_decrypt_template"
  | "cmd_default_headers"
  | "cmd_delete_all_grpc_connections"
  | "cmd_delete_all_http_responses"
  | "cmd_delete_send_history"
  | "cmd_dismiss_notification"
  | "cmd_export_data"
  | "cmd_format_graphql"
  | "cmd_format_json"
  | "cmd_get_http_authentication_config"
  | "cmd_get_http_authentication_summaries"
  | "cmd_get_http_response_events"
  | "cmd_get_sse_events"
  | "cmd_get_themes"
  | "cmd_get_workspace_meta"
  | "cmd_git_add_credential"
  | "cmd_git_clone"
  | "cmd_grpc_go"
  | "cmd_grpc_reflect"
  | "cmd_grpc_request_actions"
  | "cmd_http_request_actions"
  | "cmd_websocket_request_actions"
  | "cmd_workspace_actions"
  | "cmd_folder_actions"
  | "cmd_http_request_body"
  | "cmd_http_response_body"
  | "cmd_import_data"
  | "cmd_metadata"
  | "cmd_restart"
  | "cmd_new_child_window"
  | "cmd_new_main_window"
  | "cmd_plugin_info"
  | "cmd_plugin_init_errors"
  | "cmd_reload_plugins"
  | "cmd_render_template"
  | "cmd_save_base64_to_binary"
  | "cmd_save_response"
  | "cmd_secure_template"
  | "cmd_send_ephemeral_request"
  | "cmd_send_feedback"
  | "cmd_send_http_request"
  | "cmd_template_function_summaries"
  | "cmd_template_function_config"
  | "cmd_template_tokens_to_string"
  | "models_get_graphql_introspection"
  | "models_get_settings"
  | "models_grpc_events"
  | "models_upsert_graphql_introspection"
  | "models_websocket_events"
  | "plugin:yaak-license|check";

/** Call a backend command. */
export function rpc<T>(cmd: AppCmd, payload?: RpcPayload): Promise<T> {
  return platform.rpc<T>(cmd, payload);
}
