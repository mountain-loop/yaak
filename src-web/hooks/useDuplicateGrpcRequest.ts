import { useMutation } from './useMutation';
import type { GrpcRequest } from '@yaakapp-internal/models';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { router } from '../main';
import { Route } from '../routes/workspaces/$workspaceId/requests/$requestId';
import { getGrpcProtoFiles, setGrpcProtoFiles } from './useGrpcProtoFiles';

export function useDuplicateGrpcRequest({
  id,
  navigateAfter,
}: {
  id: string | null;
  navigateAfter: boolean;
}) {
  return useMutation<GrpcRequest, string>({
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
          to: Route.fullPath,
          params: { workspaceId: request.workspaceId, requestId: request.id },
          search: (prev) => ({ ...prev }),
        });
      }
    },
  });
}
