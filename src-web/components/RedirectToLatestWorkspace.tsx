import { useEffect } from 'react';
import { getRecentCookieJars } from '../hooks/useRecentCookieJars';
import { getRecentEnvironments } from '../hooks/useRecentEnvironments';
import { getRecentRequests } from '../hooks/useRecentRequests';
import { useRecentWorkspaces } from '../hooks/useRecentWorkspaces';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { router } from '../main';
import { Route as WorkspaceRoute } from '../routes/workspaces/$workspaceId';
import { Route as RequestRoute } from '../routes/workspaces/$workspaceId/requests/$requestId';

export function RedirectToLatestWorkspace() {
  const workspaces = useWorkspaces();
  const recentWorkspaces = useRecentWorkspaces();

  useEffect(() => {
    if (workspaces.length === 0) {
      console.log('No workspaces found to redirect to. Skipping.');
      return;
    }

    (async function () {
      const workspaceId = recentWorkspaces[0] ?? workspaces[0]?.id ?? 'n/a';
      const environmentId = (await getRecentEnvironments(workspaceId))[0] ?? null;
      const cookieJarId = (await getRecentCookieJars(workspaceId))[0] ?? null;
      const requestId = (await getRecentRequests(workspaceId))[0] ?? null;

      if (workspaceId != null && requestId != null) {
        await router.navigate({
          to: RequestRoute.fullPath,
          params: { workspaceId, requestId },
          search: { cookieJarId, environmentId },
        });
      } else {
        await router.navigate({
          to: WorkspaceRoute.fullPath,
          params: { workspaceId },
          search: { cookieJarId, environmentId },
        });
      }
    })();
  }, [recentWorkspaces, workspaces, workspaces.length]);

  return <></>;
}
