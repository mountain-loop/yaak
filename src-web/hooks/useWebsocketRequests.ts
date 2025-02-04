import type { WebsocketRequest } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { jotaiStore } from '../lib/jotai';

export const websocketRequestsAtom = atom<WebsocketRequest[]>([]);

export function useWebsocketRequests() {
  return useAtomValue(websocketRequestsAtom);
}

export function getWebsocketRequest(id: string) {
  return jotaiStore.get(websocketRequestsAtom).find((r) => r.id === id) ?? null;
}
