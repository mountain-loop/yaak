import type { GrpcRequest } from '@yaakapp-internal/models';
import { trackEvent } from '../lib/analytics';
import { jotaiStore } from '../lib/jotai';
import { invokeCmd } from '../lib/tauri';
import { getActiveRequest } from './useActiveRequest';
import { activeWorkspaceAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';
import { router } from '../lib/router';

export function useCreateGrpcRequest() {
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
      await router.navigate({
        to: '/workspaces/$workspaceId',
        params: { workspaceId: request.workspaceId },
        search: (prev) => ({ ...prev, request_id: request.id }),
      });
    },
  });
}
