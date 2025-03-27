import { invoke } from '@tauri-apps/api/core';
import type { WebsocketConnection, WebsocketEvent } from '@yaakapp-internal/models';
import { websocketConnectionsAtom } from '@yaakapp-internal/models';
import { atom } from 'jotai/index';
import { atomWithKVStorage } from '../lib/atoms/atomWithKVStorage';
import { jotaiStore } from '../lib/jotai';
import { activeRequestIdAtom } from './useActiveRequestId';

const pinnedWebsocketConnectionIdAtom = atomWithKVStorage<Record<string, string | null>>(
  'pinned-websocket-connection-ids',
  {},
);

function recordKey(activeRequestId: string | null, latestConnection: WebsocketConnection | null) {
  return activeRequestId + '-' + (latestConnection?.id ?? 'none');
}

export const activeWebsocketConnectionsAtom = atom<WebsocketConnection[]>((get) => {
  const activeRequestId = get(activeRequestIdAtom) ?? 'n/a';
  return get(websocketConnectionsAtom).filter((c) => c.requestId === activeRequestId) ?? [];
});

export const activeWebsocketConnectionAtom = atom<WebsocketConnection | null>((get) => {
  const activeRequestId = get(activeRequestIdAtom) ?? 'n/a';
  const activeConnections = get(activeWebsocketConnectionsAtom);
  const latestConnection = activeConnections[0] ?? null;
  const pinnedConnectionId = get(pinnedWebsocketConnectionIdAtom)[
    recordKey(activeRequestId, latestConnection)
  ];
  return activeConnections.find((c) => c.id === pinnedConnectionId) ?? activeConnections[0] ?? null;
});

export const activeWebsocketEventsAtom = atom(async (get) => {
  const connection = get(activeWebsocketConnectionAtom);
  return invoke<WebsocketEvent[]>('plugin:yaak-models|websocket_events', {
    connectionId: connection?.id ?? 'n/a',
  });
});

export function setPinnedWebsocketConnectionId(id: string | null) {
  const activeRequestId = jotaiStore.get(activeRequestIdAtom);
  const activeConnections = jotaiStore.get(activeWebsocketConnectionsAtom);
  const latestConnection = activeConnections[0] ?? null;
  if (activeRequestId == null) return;
  jotaiStore.set(pinnedWebsocketConnectionIdAtom, (prev) => {
    return { ...prev, [recordKey(activeRequestId, latestConnection)]: id };
  });
}
