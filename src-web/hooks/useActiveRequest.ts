import type { GrpcRequest, HttpRequest } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { jotaiStore } from '../routes/__root';
import { activeRequestIdAtom } from './useActiveRequestId';
import { grpcRequestsAtom } from './useGrpcRequests';
import { httpRequestsAtom } from './useHttpRequests';

interface TypeMap {
  http_request: HttpRequest;
  grpc_request: GrpcRequest;
}

export const activeRequestAtom = atom<HttpRequest | GrpcRequest | null>((get) => {
  const activeRequestId = get(activeRequestIdAtom);
  const requests = [...get(httpRequestsAtom), ...get(grpcRequestsAtom)];
  return requests.find((r) => r.id === activeRequestId) ?? null;
});

export function getActiveRequest() {
  return jotaiStore.get(activeRequestAtom);
}

export function useActiveRequest<T extends keyof TypeMap>(
  model?: T | undefined,
): TypeMap[T] | null {
  const activeRequest = useAtomValue(activeRequestAtom);
  if (model == null) return activeRequest as TypeMap[T];
  if (activeRequest?.model === model) return activeRequest as TypeMap[T];
  return null;
}
