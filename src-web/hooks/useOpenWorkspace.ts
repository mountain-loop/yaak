import { useNavigate, useRouter } from '@tanstack/react-router';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';
import { getRecentCookieJars } from './useRecentCookieJars';
import { getRecentEnvironments } from './useRecentEnvironments';
import { getRecentRequests } from './useRecentRequests';

export function useOpenWorkspace() {
  const router = useRouter();
  const navigate = useNavigate();

  return useFastMutation({
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
      const search = { environment_id: environmentId, cookie_jar_id: cookieJarId };

      if (inNewWindow) {
        const location = router.buildLocation({
          to: '/workspaces/$workspaceId',
          params: { workspaceId },
          search,
        });
        await invokeCmd('cmd_new_main_window', { url: location.href });
        return;
      }

      if (requestId != null) {
        await navigate({
          to: '/workspaces/$workspaceId/requests/$requestId',
          params: { workspaceId, requestId },
          search,
        });
      } else {
        await navigate({ to: '/workspaces/$workspaceId', params: { workspaceId }, search });
      }
    },
  });
}
