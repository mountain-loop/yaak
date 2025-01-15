import { useDeleteAnyGrpcRequest } from './useDeleteAnyGrpcRequest';
import { useDeleteAnyHttpRequest } from './useDeleteAnyHttpRequest';
import { useFastMutation } from './useFastMutation';

export function useDeleteAnyRequest() {
  const deleteAnyHttpRequest = useDeleteAnyHttpRequest();
  const deleteAnyGrpcRequest = useDeleteAnyGrpcRequest();

  return useFastMutation<void, string, string>({
    mutationKey: ['delete_request'],
    mutationFn: async (id) => {
      if (id == null) return;
      // We don't know what type it is based on the ID, so just try deleting both
      deleteAnyHttpRequest.mutate(id);
      deleteAnyGrpcRequest.mutate(id);
    },
  });
}
