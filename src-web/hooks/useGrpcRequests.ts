import type { GrpcRequest } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { jotaiStore } from '../lib/jotai';

export const grpcRequestsAtom = atom<GrpcRequest[]>([]);

export function useGrpcRequests() {
  return useAtomValue(grpcRequestsAtom);
}

export function getGrpcRequest(id: string) {
  return jotaiStore.get(grpcRequestsAtom).find((r) => r.id === id) ?? null;
}
