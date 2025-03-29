import type { HttpRequest } from '@yaakapp-internal/models';
import { createWorkspaceModel } from '@yaakapp-internal/models';
import { jotaiStore } from '../lib/jotai';
import { router } from '../lib/router';
import { activeRequestAtom } from './useActiveRequest';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useCreateHttpRequest() {
  return useFastMutation<string, unknown, Partial<HttpRequest>>({
    mutationKey: ['create_http_request'],
    mutationFn: async (patch = {}) => {
      const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      if (workspaceId == null) {
        throw new Error("Cannot create request when there's no active workspace");
      }

      const activeRequest = jotaiStore.get(activeRequestAtom);
      if (patch.sortPriority === undefined) {
        if (activeRequest != null) {
          // Place above currently active request
          patch.sortPriority = activeRequest.sortPriority - 0.0001;
        } else {
          // Place at the very top
          patch.sortPriority = -Date.now();
        }
      }
      patch.folderId = patch.folderId || activeRequest?.folderId;
      return createWorkspaceModel({ model: 'http_request', workspaceId, ...patch });
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
