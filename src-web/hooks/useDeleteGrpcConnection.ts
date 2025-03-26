import type { GrpcConnection } from '@yaakapp-internal/models';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useDeleteGrpcConnection(id: string | null) {
  return useFastMutation<GrpcConnection>({
    mutationKey: ['delete_grpc_connection', id],
    mutationFn: async () => {
      return await invokeCmd('cmd_delete_grpc_connection', { id: id });
    },
  });
}
