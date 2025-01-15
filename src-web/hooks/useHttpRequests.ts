import type { HttpRequest } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';

export const httpRequestsAtom = atom<HttpRequest[]>([]);

export function useHttpRequests() {
  return useAtomValue(httpRequestsAtom);
}
