import type { GrpcRequest } from '@yaakapp-internal/models';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';
import { getGrpcRequest } from './useGrpcRequests';

export function useUpdateAnyGrpcRequest() {
  return useFastMutation<
    GrpcRequest,
    unknown,
    { id: string; update: Partial<GrpcRequest> | ((r: GrpcRequest) => GrpcRequest) }
  >({
    mutationKey: ['update_any_grpc_request'],
    mutationFn: async ({ id, update }) => {
      const request = getGrpcRequest(id);
      if (request === null) {
        throw new Error("Can't update a null request");
      }

      const patchedRequest =
        typeof update === 'function' ? update(request) : { ...request, ...update };
      return invokeCmd<GrpcRequest>('cmd_update_grpc_request', { request: patchedRequest });
    },
  });
}
