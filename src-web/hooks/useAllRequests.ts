import {
  grpcRequestsAtom,
  httpRequestsAtom,
  websocketRequestsAtom,
} from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';

export const allRequestsAtom = atom(function (get) {
  return [...get(httpRequestsAtom), ...get(grpcRequestsAtom), ...get(websocketRequestsAtom)];
});

export function useAllRequests() {
  return useAtomValue(allRequestsAtom);
}
