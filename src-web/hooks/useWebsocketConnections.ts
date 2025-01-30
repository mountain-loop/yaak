import type { WebsocketConnection } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { jotaiStore } from '../lib/jotai';

export const websocketConnectionsAtom = atom<WebsocketConnection[]>([]);

export function useWebsocketConnections() {
  return useAtomValue(websocketConnectionsAtom);
}

export function useLatestWebsocketConnection(requestId: string | null): WebsocketConnection | null {
  return useWebsocketConnections().find((r) => r.requestId === requestId) ?? null;
}

export function getWebsocketConnection(id: string) {
  return jotaiStore.get(websocketConnectionsAtom).find((r) => r.id === id) ?? null;
}
