import { invoke } from '@tauri-apps/api/core';
import { WebsocketConnection, WebsocketRequest } from '@yaakapp-internal/models';

export function upsertWebsocketRequest(
  request: WebsocketRequest | Partial<Omit<WebsocketRequest, 'id'>>,
) {
  return invoke('plugin:yaak-ws|upsert_request', {
    request,
  }) as Promise<WebsocketRequest>;
}

export function listWebsocketRequests({ workspaceId }: { workspaceId: string }) {
  return invoke('plugin:yaak-ws|list_requests', { workspaceId }) as Promise<WebsocketRequest[]>;
}

export function listWebsocketConnections({ requestId }: { requestId: string }) {
  return invoke('plugin:yaak-ws|list_connections', { requestId }) as Promise<WebsocketConnection[]>;
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
