import type { GrpcRequest } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';

export const grpcRequestsAtom = atom<GrpcRequest[]>([]);

export function useGrpcRequests() {
  return useAtomValue(grpcRequestsAtom);
}
