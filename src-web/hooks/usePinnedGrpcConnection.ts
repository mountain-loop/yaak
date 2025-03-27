import { invoke } from '@tauri-apps/api/core';
import type { GrpcConnection, GrpcEvent } from '@yaakapp-internal/models';
import { grpcConnectionsAtom } from '@yaakapp-internal/models';
import { atom } from 'jotai/index';
import { atomWithKVStorage } from '../lib/atoms/atomWithKVStorage';
import { jotaiStore } from '../lib/jotai';
import { activeRequestIdAtom } from './useActiveRequestId';

const pinnedGrpcConnectionIdAtom = atomWithKVStorage<Record<string, string | null>>(
  'pinned-grpc-connection-ids',
  {},
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
  const pinnedConnectionId = get(pinnedGrpcConnectionIdAtom)[
    recordKey(activeRequestId, latestConnection)
  ];
  return activeConnections.find((c) => c.id === pinnedConnectionId) ?? activeConnections[0] ?? null;
});

export const activeGrpcEventsAtom = atom(async (get) => {
  const connection = get(activeGrpcConnectionAtom);
  return invoke<GrpcEvent[]>('plugin:yaak-models|grpc_events', {
    connectionId: connection?.id ?? 'n/a',
  });
});

export function setPinnedGrpcConnectionId(id: string | null) {
  const activeRequestId = jotaiStore.get(activeRequestIdAtom);
  const activeConnections = jotaiStore.get(activeGrpcConnections);
  const latestConnection = activeConnections[0] ?? null;
  if (activeRequestId == null) return;
  jotaiStore.set(pinnedGrpcConnectionIdAtom, (prev) => {
    return { ...prev, [recordKey(activeRequestId, latestConnection)]: id };
  });
}
