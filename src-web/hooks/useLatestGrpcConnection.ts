import type { GrpcConnection } from '@yaakapp-internal/models';
import { useGrpcConnections } from './useGrpcConnections';

export function useLatestGrpcConnection(requestId: string | null): GrpcConnection | null {
  return useGrpcConnections().find((c) => c.requestId === requestId) ?? null;
}
