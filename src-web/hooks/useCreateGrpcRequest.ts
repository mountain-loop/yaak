import { useMutation } from './useMutation';
import type { GrpcRequest } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { router } from '../main';
import { Route } from '../routes/workspaces/$workspaceId/requests/$requestId';
import { getActiveRequest } from './useActiveRequest';
import { useActiveWorkspace } from './useActiveWorkspace';
import { grpcRequestsAtom } from './useGrpcRequests';
import { updateModelList } from './useSyncModelStores';

export function useCreateGrpcRequest() {
  const workspace = useActiveWorkspace();
  const setGrpcRequests = useSetAtom(grpcRequestsAtom);

  return useMutation<
    GrpcRequest,
    unknown,
    Partial<Pick<GrpcRequest, 'name' | 'sortPriority' | 'folderId'>>
  >({
    mutationKey: ['create_grpc_request'],
    mutationFn: async (patch) => {
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

      router.navigate({
        to: Route.fullPath,
        params: {
          workspaceId: request.workspaceId,
          requestId: request.id,
        },
        search: (prev) => ({ ...prev }),
      });
    },
  });
}
