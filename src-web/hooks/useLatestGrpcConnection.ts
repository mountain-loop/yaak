import type { GrpcConnection} from '@yaakapp-internal/models';
import { grpcConnectionsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai/index';

export function useLatestGrpcConnection(requestId: string | null): GrpcConnection | null {
  return useAtomValue(grpcConnectionsAtom).find((c) => c.requestId === requestId) ?? null;
}
