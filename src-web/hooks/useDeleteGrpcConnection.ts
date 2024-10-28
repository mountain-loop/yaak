import { useMutation } from '@tanstack/react-query';
import type { GrpcConnection } from '@yaakapp-internal/models';
import {useSetAtom} from "jotai";
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import {grpcConnectionsAtom} from "./useGrpcConnections";
import {removeModelById} from "./useSyncModelStores";

export function useDeleteGrpcConnection(id: string | null) {
  const setGrpcConnections = useSetAtom(grpcConnectionsAtom);
  return useMutation<GrpcConnection>({
    mutationKey: ['delete_grpc_connection', id],
    mutationFn: async () => {
      return await invokeCmd('cmd_delete_grpc_connection', { id: id });
    },
    onSettled: () => trackEvent('grpc_connection', 'delete'),
    onSuccess: (connection) => {
      if (connection == null) return;

      setGrpcConnections(removeModelById(connection));
    }
  });
}
