import type { HttpRequest } from '@yaakapp-internal/models';
import { useModelList } from '@yaakapp-internal/models';
import { getModel } from '@yaakapp-internal/models/guest-js/store';
import { atom } from 'jotai';

export const httpRequestsAtom = atom<HttpRequest[]>([]);

export function useHttpRequests() {
  return useModelList('http_request');
}

export function getHttpRequest(id: string) {
  return getModel('http_request', id);
}
