import { useMutation } from './useMutation';
import type { HttpRequest } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai/index';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { router } from '../main';
import { Route } from '../routes/workspaces/$workspaceId/requests/$requestId';
import { getActiveRequest } from './useActiveRequest';
import { useActiveWorkspace } from './useActiveWorkspace';
import { httpRequestsAtom } from './useHttpRequests';
import { updateModelList } from './useSyncModelStores';

export function useCreateHttpRequest() {
  const activeWorkspace = useActiveWorkspace();
  const setHttpRequests = useSetAtom(httpRequestsAtom);

  return useMutation<HttpRequest, unknown, Partial<HttpRequest>>({
    mutationKey: ['create_http_request'],
    mutationFn: async (patch = {}) => {
      const activeRequest = getActiveRequest();
      if (activeWorkspace === null) {
        throw new Error("Cannot create request when there's no active workspace");
      }
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
        request: { workspaceId: activeWorkspace.id, ...patch },
      });
    },
    onSettled: () => trackEvent('http_request', 'create'),
    onSuccess: async (request) => {
      // Optimistic update
      setHttpRequests(updateModelList(request));

      await router.navigate({
        to: Route.fullPath,
        params: { workspaceId: request.workspaceId, requestId: request.id },
        search: (prev) => ({ ...prev }),
      });
    },
  });
}
