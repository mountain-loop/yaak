import { invoke } from '@tauri-apps/api/core';
import { WebsocketConnection, WebsocketEvent, WebsocketRequest } from '@yaakapp-internal/models';

export function upsertWebsocketRequest(
  request: WebsocketRequest | Partial<Omit<WebsocketRequest, 'id'>>,
) {
  return invoke('plugin:yaak-ws|upsert_request', {
    request,
  }) as Promise<WebsocketRequest>;
}

export function duplicateWebsocketRequest(requestId: string) {
  return invoke('plugin:yaak-ws|duplicate_request', {
    requestId,
  }) as Promise<WebsocketRequest>;
}

export function deleteWebsocketRequest(requestId: string) {
  return invoke('plugin:yaak-ws|delete_request', {
    requestId,
  });
}

export function deleteWebsocketConnection(connectionId: string) {
  return invoke('plugin:yaak-ws|delete_connection', {
    connectionId,
  });
}

export function deleteWebsocketConnections(requestId: string) {
  return invoke('plugin:yaak-ws|delete_connections', {
    requestId,
  });
}

export function listWebsocketRequests({ workspaceId }: { workspaceId: string }) {
  return invoke('plugin:yaak-ws|list_requests', { workspaceId }) as Promise<WebsocketRequest[]>;
}

export function listWebsocketEvents({ connectionId }: { connectionId: string }) {
  return invoke('plugin:yaak-ws|list_events', { connectionId }) as Promise<WebsocketEvent[]>;
}

export function listWebsocketConnections({ workspaceId }: { workspaceId: string }) {
  return invoke('plugin:yaak-ws|list_connections', { workspaceId }) as Promise<
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
  return invoke('plugin:yaak-ws|connect', {
    requestId,
    environmentId,
    cookieJarId,
  }) as Promise<WebsocketConnection>;
}

export function closeWebsocket({ connectionId }: { connectionId: string }) {
  return invoke('plugin:yaak-ws|close', {
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
  return invoke('plugin:yaak-ws|send', {
    connectionId,
    environmentId,
  });
}
