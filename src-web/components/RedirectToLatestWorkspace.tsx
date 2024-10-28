import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppRoutes } from '../hooks/useAppRoutes';
import { getRecentCookieJars } from '../hooks/useRecentCookieJars';
import { getRecentEnvironments } from '../hooks/useRecentEnvironments';
import { getRecentRequests } from '../hooks/useRecentRequests';
import { useRecentWorkspaces } from '../hooks/useRecentWorkspaces';
import { useWorkspaces } from '../hooks/useWorkspaces';

export function RedirectToLatestWorkspace() {
  const navigate = useNavigate();
  const routes = useAppRoutes();
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
        navigate(routes.paths.request({ workspaceId, environmentId, requestId, cookieJarId }));
      } else {
        navigate(routes.paths.workspace({ workspaceId, environmentId, cookieJarId }));
      }
    })();
  }, [navigate, recentWorkspaces, routes.paths, workspaces, workspaces.length]);

  return <></>;
}
