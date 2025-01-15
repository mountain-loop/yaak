import type { GrpcConnection, GrpcRequest } from '@yaakapp-internal/models';
import { useGrpcConnections } from './useGrpcConnections';
import { useKeyValue } from './useKeyValue';
import { useLatestGrpcConnection } from './useLatestGrpcConnection';

export function usePinnedGrpcConnection(activeRequest: GrpcRequest) {
  const latestConnection = useLatestGrpcConnection(activeRequest.id);
  const { set: setPinnedConnectionId, value: pinnedConnectionId } = useKeyValue<string | null>({
    // Key on latest connection instead of activeRequest because connections change out of band of active request
    key: ['pinned_grpc_connection_id', latestConnection?.id ?? 'n/a'],
    fallback: null,
    namespace: 'global',
  });
  const connections = useGrpcConnections().filter((c) => c.requestId === activeRequest.id);
  const activeConnection: GrpcConnection | null =
    connections.find((r) => r.id === pinnedConnectionId) ?? latestConnection;

  return { activeConnection, setPinnedConnectionId, pinnedConnectionId, connections } as const;
}
