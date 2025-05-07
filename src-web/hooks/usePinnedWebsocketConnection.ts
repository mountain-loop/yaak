import { invoke } from '@tauri-apps/api/core';
import type { WebsocketConnection, WebsocketEvent } from '@yaakapp-internal/models';
import { replaceModelsInStore , websocketConnectionsAtom, websocketEventsAtom } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
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

export function setPinnedWebsocketConnectionId(id: string | null) {
  const activeRequestId = jotaiStore.get(activeRequestIdAtom);
  const activeConnections = jotaiStore.get(activeWebsocketConnectionsAtom);
  const latestConnection = activeConnections[0] ?? null;
  if (activeRequestId == null) return;
  jotaiStore.set(pinnedWebsocketConnectionIdAtom, (prev) => {
    return { ...prev, [recordKey(activeRequestId, latestConnection)]: id };
  });
}

export function useWebsocketEvents(connectionId: string | null) {
  const events = useAtomValue(websocketEventsAtom);

  useEffect(() => {
    invoke<WebsocketEvent[]>('plugin:yaak-models|websocket_events', { connectionId }).then(
      (events) => replaceModelsInStore('websocket_event', events),
    );
  }, [connectionId]);

  return events;
}
