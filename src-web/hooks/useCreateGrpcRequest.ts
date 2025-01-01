import { useNavigate } from '@tanstack/react-router';
import type { GrpcRequest } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai';
import { trackEvent } from '../lib/analytics';
import { jotaiStore } from '../lib/jotai';
import { invokeCmd } from '../lib/tauri';
import { getActiveRequest } from './useActiveRequest';
import { activeWorkspaceAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';
import { grpcRequestsAtom } from './useGrpcRequests';
import { updateModelList } from './useSyncModelStores';

export function useCreateGrpcRequest() {
  const setGrpcRequests = useSetAtom(grpcRequestsAtom);
  const navigate = useNavigate();

  return useFastMutation<
    GrpcRequest,
    unknown,
    Partial<Pick<GrpcRequest, 'name' | 'sortPriority' | 'folderId'>>
  >({
    mutationKey: ['create_grpc_request'],
    mutationFn: async (patch) => {
      const workspace = jotaiStore.get(activeWorkspaceAtom);
      if (workspace === null) {
        throw new Error("Cannot create grpc request when there's no active workspace");
      }
      const activeRequest = getActiveRequest();
      if (patch.sortPriority === undefined) {
        if (activeRequest != null) {
          // Place above currently active request
          patch.sortPriority = activeRequest.sortPriority + 0.0001;
        } else {
          // Place at the very top
          patch.sortPriority = -Date.now();
        }
      }
      patch.folderId = patch.folderId || activeRequest?.folderId;
      return invokeCmd<GrpcRequest>('cmd_create_grpc_request', {
        workspaceId: workspace.id,
        name: '',
        ...patch,
      });
    },
    onSettled: () => trackEvent('grpc_request', 'create'),
    onSuccess: async (request) => {
      // Optimistic update
      setGrpcRequests(updateModelList(request));

      await navigate({
        to: '/workspaces/$workspaceId/requests/$requestId',
        params: {
          workspaceId: request.workspaceId,
          requestId: request.id,
        },
        search: (prev) => ({ ...prev }),
      });
    },
  });
}
