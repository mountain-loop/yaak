import type { GrpcRequest } from '@yaakapp-internal/models';
import { trackEvent } from '../lib/analytics';
import { router } from '../lib/router';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';
import { getGrpcProtoFiles, setGrpcProtoFiles } from './useGrpcProtoFiles';

export function useDuplicateGrpcRequest({
  id,
  navigateAfter,
}: {
  id: string | null;
  navigateAfter: boolean;
}) {
  return useFastMutation<GrpcRequest, string>({
    mutationKey: ['duplicate_grpc_request', id],
    mutationFn: async () => {
      if (id === null) throw new Error("Can't duplicate a null grpc request");
      return invokeCmd('cmd_duplicate_grpc_request', { id });
    },
    onSettled: () => trackEvent('grpc_request', 'duplicate'),
    onSuccess: async (request) => {
      if (id == null) return;

      // Also copy proto files to new request
      const protoFiles = await getGrpcProtoFiles(id);
      await setGrpcProtoFiles(request.id, protoFiles);

      if (navigateAfter) {
        await router.navigate({
          to: '/workspaces/$workspaceId',
          params: { workspaceId: request.workspaceId },
          search: (prev) => ({ ...prev, request_id: request.id }),
        });
      }
    },
  });
}
