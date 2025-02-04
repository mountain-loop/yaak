import { deleteWebsocketRequest } from '../commands/deleteWebsocketRequest';
import { jotaiStore } from '../lib/jotai';
import { useDeleteAnyGrpcRequest } from './useDeleteAnyGrpcRequest';
import { useDeleteAnyHttpRequest } from './useDeleteAnyHttpRequest';
import { useFastMutation } from './useFastMutation';
import { requestsAtom } from './useRequests';

export function useDeleteAnyRequest() {
  const deleteAnyHttpRequest = useDeleteAnyHttpRequest();
  const deleteAnyGrpcRequest = useDeleteAnyGrpcRequest();

  return useFastMutation<void, string, string>({
    mutationKey: ['delete_request'],
    mutationFn: async (id) => {
      if (id == null) return;
      const request = jotaiStore.get(requestsAtom).find((r) => r.id === id);

      if (request?.model === 'websocket_request') {
        deleteWebsocketRequest.mutate(request);
      } else if (request?.model === 'http_request') {
        deleteAnyHttpRequest.mutate(request);
      } else if (request?.model === 'grpc_request') {
        deleteAnyGrpcRequest.mutate(request);
      } else {
        console.log('Failed to delete request', id, request);
      }
    },
  });
}
