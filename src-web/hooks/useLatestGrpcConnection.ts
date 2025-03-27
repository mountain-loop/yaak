import type { GrpcConnection} from '@yaakapp-internal/models';
import { useModelList } from '@yaakapp-internal/models';

export function useLatestGrpcConnection(requestId: string | null): GrpcConnection | null {
  return useModelList('grpc_connection').find((c) => c.requestId === requestId) ?? null;
}
