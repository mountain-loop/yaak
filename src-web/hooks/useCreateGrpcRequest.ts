import type { GrpcRequest } from '@yaakapp-internal/models';
import { createWorkspaceModel } from '@yaakapp-internal/models';
import { jotaiStore } from '../lib/jotai';
import { router } from '../lib/router';
import { activeRequestAtom } from './useActiveRequest';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useCreateGrpcRequest() {
  return useFastMutation<
    string,
    unknown,
    Partial<Pick<GrpcRequest, 'name' | 'sortPriority' | 'folderId'>>
  >({
    mutationKey: ['create_grpc_request'],
    mutationFn: async (patch) => {
      const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      if (workspaceId === null) {
        throw new Error("Cannot create grpc request when there's no active workspace");
      }
      const activeRequest = jotaiStore.get(activeRequestAtom);
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
      return createWorkspaceModel({ model: 'grpc_request', workspaceId, ...patch });
    },
    onSuccess: async (requestId) => {
      const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      if (workspaceId == null) return;

      await router.navigate({
        to: '/workspaces/$workspaceId',
        params: { workspaceId },
        search: (prev) => ({ ...prev, request_id: requestId }),
      });
    },
  });
}
