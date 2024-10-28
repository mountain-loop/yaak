import { useMutation } from '@tanstack/react-query';
import type { HttpRequest } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai/index';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { useActiveCookieJar } from './useActiveCookieJar';
import { useActiveEnvironment } from './useActiveEnvironment';
import { useActiveRequest } from './useActiveRequest';
import { useActiveWorkspace } from './useActiveWorkspace';
import { useAppRoutes } from './useAppRoutes';
import { httpRequestsAtom } from './useHttpRequests';
import { updateModelList } from './useSyncModelStores';

export function useCreateHttpRequest() {
  const workspace = useActiveWorkspace();
  const [activeEnvironment] = useActiveEnvironment();
  const [activeCookieJar] = useActiveCookieJar();
  const activeRequest = useActiveRequest();
  const routes = useAppRoutes();
  const setHttpRequests = useSetAtom(httpRequestsAtom);

  return useMutation<HttpRequest, unknown, Partial<HttpRequest>>({
    mutationKey: ['create_http_request'],
    mutationFn: async (patch = {}) => {
      if (workspace === null) {
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
        request: { workspaceId: workspace.id, ...patch },
      });
    },
    onSettled: () => trackEvent('http_request', 'create'),
    onSuccess: async (request) => {
      // Optimistic update
      setHttpRequests(updateModelList(request));

      routes.navigate('request', {
        workspaceId: request.workspaceId,
        requestId: request.id,
        environmentId: activeEnvironment?.id ?? null,
        cookieJarId: activeCookieJar?.id ?? null,
      });
    },
  });
}
