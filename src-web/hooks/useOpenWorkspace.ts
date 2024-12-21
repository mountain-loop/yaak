import { useMutation } from './useMutation';
import { invokeCmd } from '../lib/tauri';
import { router } from '../main';
import { Route as WorkspaceRoute } from '../routes/workspaces/$workspaceId';
import { Route as RequestRoute } from '../routes/workspaces/$workspaceId/requests/$requestId';
import { getRecentCookieJars } from './useRecentCookieJars';
import { getRecentEnvironments } from './useRecentEnvironments';
import { getRecentRequests } from './useRecentRequests';

export function useOpenWorkspace() {
  return useMutation({
    mutationKey: ['open_workspace'],
    mutationFn: async ({
      workspaceId,
      inNewWindow,
    }: {
      workspaceId: string;
      inNewWindow: boolean;
    }) => {
      const environmentId = (await getRecentEnvironments(workspaceId))[0] ?? undefined;
      const requestId = (await getRecentRequests(workspaceId))[0] ?? undefined;
      const cookieJarId = (await getRecentCookieJars(workspaceId))[0] ?? undefined;
      const search = { environmentId, cookieJarId };

      if (inNewWindow) {
        const location = router.buildLocation({
          to: WorkspaceRoute.fullPath,
          params: { workspaceId },
          search,
        });
        await invokeCmd('cmd_new_main_window', { url: location });
        return;
      }

      if (requestId != null) {
        router.navigate({ to: RequestRoute.fullPath, params: { workspaceId, requestId }, search });
      } else {
        router.navigate({ to: WorkspaceRoute.fullPath, params: { workspaceId }, search });
      }
    },
  });
}
