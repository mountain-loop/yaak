import { createFastMutation } from '../hooks/useFastMutation';
import { getRecentCookieJars } from '../hooks/useRecentCookieJars';
import { getRecentEnvironments } from '../hooks/useRecentEnvironments';
import { getRecentRequests } from '../hooks/useRecentRequests';
import { router } from '../lib/router';
import { invokeCmd } from '../lib/tauri';

export const switchWorkspace = createFastMutation<
  void,
  unknown,
  {
    workspaceId: string;
    inNewWindow: boolean;
  }
>({
  mutationKey: ['open_workspace'],
  mutationFn: async ({ workspaceId, inNewWindow }) => {
    const environmentId = (await getRecentEnvironments(workspaceId))[0] ?? undefined;
    const requestId = (await getRecentRequests(workspaceId))[0] ?? undefined;
    const cookieJarId = (await getRecentCookieJars(workspaceId))[0] ?? undefined;
    const search = {
      environment_id: environmentId,
      cookie_jar_id: cookieJarId,
      request_id: requestId,
    };

    if (inNewWindow) {
      const location = router.buildLocation({
        to: '/workspaces/$workspaceId',
        params: { workspaceId },
        search,
      });
      await invokeCmd<void>('cmd_new_main_window', { url: location.href });
      return;
    }

    await router.navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId },
      search,
    });
  },
});
