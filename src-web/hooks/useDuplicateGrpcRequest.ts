import { useNavigate } from '@tanstack/react-router';
import type { GrpcRequest } from '@yaakapp-internal/models';
import { trackEvent } from '../lib/analytics';
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
  const navigate = useNavigate();
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
        await navigate({
          to: '/workspaces/$workspaceId/requests/$requestId',
          params: { workspaceId: request.workspaceId, requestId: request.id },
          search: (prev) => ({ ...prev }),
        });
      }
    },
  });
}
