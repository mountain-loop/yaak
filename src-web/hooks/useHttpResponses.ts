import type { HttpResponse } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { atom } from 'jotai/index';

export const httpResponsesAtom = atom<HttpResponse[]>([]);

export function useHttpResponses() {
  return useAtomValue(httpResponsesAtom);
}
