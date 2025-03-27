import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { requestsAtom } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { jotaiStore } from '../lib/jotai';
import { activeRequestIdAtom } from './useActiveRequestId';

interface TypeMap {
  http_request: HttpRequest;
  grpc_request: GrpcRequest;
  websocket_request: WebsocketRequest;
}

export const activeRequestAtom = atom((get) => {
  const activeRequestId = get(activeRequestIdAtom);
  const requests = get(requestsAtom);
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
