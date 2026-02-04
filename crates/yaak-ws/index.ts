import { invoke } from '@tauri-apps/api/core';
import { WebsocketConnection } from '@yaakapp-internal/models';

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
