import type { InvokeArgs } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';

type TauriCmd =
  | 'cmd_call_grpc_request_action'
  | 'cmd_call_http_authentication_action'
  | 'cmd_call_http_request_action'
  | 'cmd_check_for_updates'
  | 'cmd_create_grpc_request'
  | 'cmd_curl_to_request'
  | 'cmd_decrypt_template'
  | 'cmd_delete_all_grpc_connections'
  | 'cmd_delete_all_http_responses'
  | 'cmd_delete_send_history'
  | 'cmd_dismiss_notification'
  | 'cmd_export_data'
  | 'cmd_format_json'
  | 'cmd_get_http_authentication_config'
  | 'cmd_get_http_authentication_summaries'
  | 'cmd_get_sse_events'
  | 'cmd_get_themes'
  | 'cmd_get_workspace_meta'
  | 'cmd_grpc_go'
  | 'cmd_grpc_reflect'
  | 'cmd_grpc_request_actions'
  | 'cmd_http_request_actions'
  | 'cmd_http_response_body'
  | 'cmd_import_data'
  | 'cmd_install_plugin'
  | 'cmd_metadata'
  | 'cmd_restart'
  | 'cmd_new_child_window'
  | 'cmd_new_main_window'
  | 'cmd_plugin_info'
  | 'cmd_reload_plugins'
  | 'cmd_render_template'
  | 'cmd_save_response'
  | 'cmd_secure_template'
  | 'cmd_send_ephemeral_request'
  | 'cmd_send_folder'
  | 'cmd_send_http_request'
  | 'cmd_show_workspace_key'
  | 'cmd_template_functions'
  | 'cmd_template_tokens_to_string';

export async function invokeCmd<T>(cmd: TauriCmd, args?: InvokeArgs): Promise<T> {
  // console.log('RUN COMMAND', cmd, args);
  try {
    return await invoke(cmd, args);
  } catch (err) {
    console.warn('Tauri command error', cmd, err);
    throw err;
  }
}
