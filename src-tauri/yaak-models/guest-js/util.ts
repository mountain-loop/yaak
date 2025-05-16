import { ModelStoreData } from './types';

export function newStoreData(): ModelStoreData {
  return {
    cookie_jar: {},
    environment: {},
    folder: {},
    grpc_connection: {},
    grpc_event: {},
    grpc_request: {},
    http_request: {},
    http_response: {},
    key_value: {},
    plugin: {},
    settings: {},
    sync_state: {},
    websocket_connection: {},
    websocket_event: {},
    websocket_request: {},
    workspace: {},
    workspace_meta: {},
  };
}
