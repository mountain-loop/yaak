import type { WebsocketConnection, WebsocketRequest } from '@yaakapp-internal/models';
import { useKeyValue } from './useKeyValue';
import { useLatestWebsocketConnection, useWebsocketConnections } from './useWebsocketConnections';

export function usePinnedWebsocketConnection(activeRequest: WebsocketRequest) {
  const latestConnection = useLatestWebsocketConnection(activeRequest.id);
  const { set: setPinnedConnectionId, value: pinnedConnectionId } = useKeyValue<string | null>({
    // Key on latest connection instead of activeRequest because connections change out of band of active request
    key: ['pinned_websocket_connection_id', latestConnection?.id ?? 'n/a'],
    fallback: null,
    namespace: 'global',
  });
  const connections = useWebsocketConnections().filter((c) => c.requestId === activeRequest.id);
  const activeConnection: WebsocketConnection | null =
    connections.find((r) => r.id === pinnedConnectionId) ?? latestConnection;

  return { activeConnection, setPinnedConnectionId, pinnedConnectionId, connections } as const;
}
