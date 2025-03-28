import { invoke } from '@tauri-apps/api/core';
import type { GrpcConnection, GrpcEvent } from '@yaakapp-internal/models';
import { grpcConnectionsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { atom } from 'jotai/index';
import { atomWithKVStorage } from '../lib/atoms/atomWithKVStorage';
import { activeRequestIdAtom } from './useActiveRequestId';
import { useEffect, useState } from 'react';

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
  return activeRequestId + '-' + (latestConnection?.id ?? 'none');
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

// export const activeGrpcEventsAtom = atom(async (get) => {
//   const connection = get(activeGrpcConnectionAtom);
//   return invoke<GrpcEvent[]>('plugin:yaak-models|grpc_events', {
//     connectionId: connection?.id ?? 'n/a',
//   });
// });

export function useGrpcEvents() {
  const [events, setEvents] = useState<GrpcEvent[]>([]);
  const connection = useAtomValue(activeGrpcConnectionAtom);

  useEffect(() => {
    const connectionId = connection?.id ?? 'n/a';
    invoke<GrpcEvent[]>('plugin:yaak-models|grpc_events', { connectionId }).then(setEvents);
  }, [connection?.id]);

  return events;
}
