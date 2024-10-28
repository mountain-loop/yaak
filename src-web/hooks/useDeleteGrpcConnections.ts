import { useMutation } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { grpcConnectionsAtom } from './useGrpcConnections';

export function useDeleteGrpcConnections(requestId?: string) {
  const setGrpcConnections = useSetAtom(grpcConnectionsAtom);
  return useMutation({
    mutationKey: ['delete_grpc_connections', requestId],
    mutationFn: async () => {
      if (requestId === undefined) return;
      await invokeCmd('cmd_delete_all_grpc_connections', { requestId });
    },
    onSettled: () => trackEvent('grpc_connection', 'delete_many'),
    onSuccess: () => {
      setGrpcConnections((all) => all.filter((r) => r.requestId !== requestId));
    },
  });
}
