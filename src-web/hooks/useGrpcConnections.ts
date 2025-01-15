import type { GrpcConnection } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai/index';

export const grpcConnectionsAtom = atom<GrpcConnection[]>([]);

export function useGrpcConnections() {
  return useAtomValue(grpcConnectionsAtom);
}
