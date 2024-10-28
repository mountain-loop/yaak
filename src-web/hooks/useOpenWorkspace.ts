import { useMutation } from '@tanstack/react-query';
import { invokeCmd } from '../lib/tauri';
import { useAppRoutes } from './useAppRoutes';
import { getRecentCookieJars } from './useRecentCookieJars';
import { getRecentEnvironments } from './useRecentEnvironments';
import { getRecentRequests } from './useRecentRequests';

export function useOpenWorkspace() {
  const routes = useAppRoutes();

  return useMutation({
    mutationKey: ['open_workspace'],
    mutationFn: async ({
      workspaceId,
      inNewWindow,
    }: {
      workspaceId: string;
      inNewWindow: boolean;
    }) => {
      const environmentId = (await getRecentEnvironments(workspaceId))[0] ?? null;
      const requestId = (await getRecentRequests(workspaceId))[0] ?? null;
      const cookieJarId = (await getRecentCookieJars(workspaceId))[0] ?? null;
      const baseArgs = { workspaceId, environmentId, cookieJarId } as const;
      if (inNewWindow) {
        const path =
          requestId != null
            ? routes.paths.request({ ...baseArgs, requestId })
            : routes.paths.workspace({ ...baseArgs });
        await invokeCmd('cmd_new_main_window', { url: path });
      } else {
        if (requestId != null) {
          routes.navigate('request', { ...baseArgs, requestId });
        } else {
          routes.navigate('workspace', { ...baseArgs });
        }
      }
    },
  });
}
