import { invoke } from '@tauri-apps/api/core';
import { WebsocketConnection, WebsocketEvent, WebsocketRequest } from '@yaakapp-internal/models';

export function upsertWebsocketRequest(
  request: WebsocketRequest | Partial<Omit<WebsocketRequest, 'id'>>,
) {
  return invoke('cmd_ws_upsert_request', {
    request,
  }) as Promise<WebsocketRequest>;
}

export function duplicateWebsocketRequest(requestId: string) {
  return invoke('cmd_ws_duplicate_request', {
    requestId,
  }) as Promise<WebsocketRequest>;
}

export function deleteWebsocketRequest(requestId: string) {
  return invoke('cmd_ws_delete_request', {
    requestId,
  });
}

export function deleteWebsocketConnection(connectionId: string) {
  return invoke('cmd_ws_delete_connection', {
    connectionId,
  });
}

export function deleteWebsocketConnections(requestId: string) {
  return invoke('cmd_ws_delete_connections', {
    requestId,
  });
}

export function listWebsocketRequests({ workspaceId }: { workspaceId: string }) {
  return invoke('cmd_ws_list_requests', { workspaceId }) as Promise<WebsocketRequest[]>;
}

export function listWebsocketEvents({ connectionId }: { connectionId: string }) {
  return invoke('cmd_ws_list_events', { connectionId }) as Promise<WebsocketEvent[]>;
}

export function listWebsocketConnections({ workspaceId }: { workspaceId: string }) {
  return invoke('cmd_ws_list_connections', { workspaceId }) as Promise<
    WebsocketConnection[]
  >;
}

export function connectWebsocket({
  requestId,
  environmentId,
  cookieJarId,
}: {
  requestId: string;
  environmentId: string | null;
  cookieJarId: string | null;
}) {
  return invoke('cmd_ws_connect', {
    requestId,
    environmentId,
    cookieJarId,
  }) as Promise<WebsocketConnection>;
}

export function closeWebsocket({ connectionId }: { connectionId: string }) {
  return invoke('cmd_ws_close', {
    connectionId,
  });
}

export function sendWebsocket({
  connectionId,
  environmentId,
}: {
  connectionId: string;
  environmentId: string | null;
}) {
  return invoke('cmd_ws_send', {
    connectionId,
    environmentId,
  });
}
