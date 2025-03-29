import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useDeleteGrpcConnections(requestId?: string) {
  return useFastMutation({
    mutationKey: ['delete_grpc_connections', requestId],
    mutationFn: async () => {
      if (requestId === undefined) return;
      await invokeCmd('cmd_delete_all_grpc_connections', { requestId });
    },
  });
}
