import { atom, useAtomValue } from 'jotai';
import {jotaiStore} from "../lib/jotai";
import { grpcRequestsAtom } from './useGrpcRequests';
import { httpRequestsAtom } from './useHttpRequests';

const requestsAtom = atom((get) => [...get(httpRequestsAtom), ...get(grpcRequestsAtom)]);

export function useRequests() {
  return useAtomValue(requestsAtom);
}

export function getRequests() {
  return jotaiStore.get(requestsAtom);
}
