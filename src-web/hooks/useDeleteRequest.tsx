import { useDeleteAnyGrpcRequest } from './useDeleteAnyGrpcRequest';
import { useDeleteAnyHttpRequest } from './useDeleteAnyHttpRequest';
import { useFastMutation } from './useFastMutation';

export function useDeleteRequest(id: string | null) {
  const deleteAnyHttpRequest = useDeleteAnyHttpRequest();
  const deleteAnyGrpcRequest = useDeleteAnyGrpcRequest();

  return useFastMutation<void, string>({
    mutationKey: ['delete_request', id],
    mutationFn: async () => {
      if (id == null) return;
      // We don't know what type it is based on the ID, so just try deleting both
      deleteAnyHttpRequest.mutate(id);
      deleteAnyGrpcRequest.mutate(id);
    },
  });
}
