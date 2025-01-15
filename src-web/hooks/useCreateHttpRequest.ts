import type { HttpRequest } from '@yaakapp-internal/models';
import { trackEvent } from '../lib/analytics';
import { router } from '../lib/router';
import { invokeCmd } from '../lib/tauri';
import { getActiveRequest } from './useActiveRequest';
import { getActiveWorkspaceId } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useCreateHttpRequest() {
  return useFastMutation<HttpRequest, unknown, Partial<HttpRequest>>({
    mutationKey: ['create_http_request'],
    mutationFn: async (patch = {}) => {
      const workspaceId = getActiveWorkspaceId();
      if (workspaceId == null) {
        throw new Error("Cannot create request when there's no active workspace");
      }

      const activeRequest = getActiveRequest();
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
      return invokeCmd<HttpRequest>('cmd_create_http_request', {
        request: { workspaceId, ...patch },
      });
    },
    onSettled: () => trackEvent('http_request', 'create'),
    onSuccess: async (request) => {
      await router.navigate({
        to: '/workspaces/$workspaceId',
        params: { workspaceId: request.workspaceId },
        search: (prev) => ({ ...prev, request_id: request.id }),
      });
    },
  });
}
