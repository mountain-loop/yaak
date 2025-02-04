import type { GrpcRequest } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai/index';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';
import { getGrpcRequest, grpcRequestsAtom } from './useGrpcRequests';
import { updateModelList } from './useSyncModelStores';

export function useUpdateAnyGrpcRequest() {
  const setGrpcRequests = useSetAtom(grpcRequestsAtom);
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
    onSuccess: (request) => {
      setGrpcRequests(updateModelList(request));
    },
  });
}
