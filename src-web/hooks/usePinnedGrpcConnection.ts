import { invoke } from '@tauri-apps/api/core';
import type { GrpcConnection, GrpcEvent } from '@yaakapp-internal/models';
import {
  grpcConnectionsAtom,
  grpcEventsAtom,
  mergeModelsInStore,
  replaceModelsInStore,
} from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { atomWithKVStorage } from '../lib/atoms/atomWithKVStorage';
import { activeRequestIdAtom } from './useActiveRequestId';

const pinnedGrpcConnectionIdsAtom = atomWithKVStorage<Record<string, string | null>>(
  'pinned-grpc-connection-ids',
  {},
);

export const pinnedGrpcConnectionIdAtom = atom(
  (get) => {
    const activeRequestId = get(activeRequestIdAtom);
    const activeConnections = get(activeGrpcConnections);
    const latestConnection = activeConnections[0] ?? null;
    if (!activeRequestId) return null;

    const key = recordKey(activeRequestId, latestConnection);
    return get(pinnedGrpcConnectionIdsAtom)[key] ?? null;
  },
  (get, set, id: string | null) => {
    const activeRequestId = get(activeRequestIdAtom);
    const activeConnections = get(activeGrpcConnections);
    const latestConnection = activeConnections[0] ?? null;
    if (!activeRequestId) return;

    const key = recordKey(activeRequestId, latestConnection);
    set(pinnedGrpcConnectionIdsAtom, (prev) => ({
      ...prev,
      [key]: id,
    }));
  },
);

function recordKey(activeRequestId: string | null, latestConnection: GrpcConnection | null) {
  return `${activeRequestId}-${latestConnection?.id ?? 'none'}`;
}

export const activeGrpcConnections = atom<GrpcConnection[]>((get) => {
  const activeRequestId = get(activeRequestIdAtom) ?? 'n/a';
  return get(grpcConnectionsAtom).filter((c) => c.requestId === activeRequestId) ?? [];
});

export const activeGrpcConnectionAtom = atom<GrpcConnection | null>((get) => {
  const activeRequestId = get(activeRequestIdAtom) ?? 'n/a';
  const activeConnections = get(activeGrpcConnections);
  const latestConnection = activeConnections[0] ?? null;
  const pinnedConnectionId = get(pinnedGrpcConnectionIdsAtom)[
    recordKey(activeRequestId, latestConnection)
  ];
  return activeConnections.find((c) => c.id === pinnedConnectionId) ?? activeConnections[0] ?? null;
});

export function useGrpcEvents(connectionId: string | null) {
  const events = useAtomValue(grpcEventsAtom);

  useEffect(() => {
    if (connectionId == null) {
      replaceModelsInStore('grpc_event', []);
      return;
    }

    // Use merge instead of replace to preserve events that came in via model_write
    // while we were fetching from the database
    invoke<GrpcEvent[]>('models_grpc_events', { connectionId }).then((events) => {
      mergeModelsInStore('grpc_event', events);
    });
  }, [connectionId]);

  return events;
}
