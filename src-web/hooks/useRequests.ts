import { atom, useAtomValue } from 'jotai';
import { grpcRequestsAtom } from './useGrpcRequests';
import { httpRequestsAtom } from './useHttpRequests';
import { websocketRequestsAtom } from './useWebsocketRequests';

export const requestsAtom = atom((get) => [
  ...get(httpRequestsAtom),
  ...get(grpcRequestsAtom),
  ...get(websocketRequestsAtom),
]);

export function useRequests() {
  return useAtomValue(requestsAtom);
}
