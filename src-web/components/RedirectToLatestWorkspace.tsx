import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { getRecentCookieJars } from '../hooks/useRecentCookieJars';
import { getRecentEnvironments } from '../hooks/useRecentEnvironments';
import { getRecentRequests } from '../hooks/useRecentRequests';
import { useRecentWorkspaces } from '../hooks/useRecentWorkspaces';
import { useWorkspaces } from '../hooks/useWorkspaces';

export function RedirectToLatestWorkspace() {
  const workspaces = useWorkspaces();
  const recentWorkspaces = useRecentWorkspaces();
  const navigate = useNavigate();

  useEffect(() => {
    if (workspaces.length === 0 || recentWorkspaces == null) {
      console.log('No workspaces found to redirect to. Skipping.');
      return;
    }

    (async function () {
      const workspaceId = recentWorkspaces[0] ?? workspaces[0]?.id ?? 'n/a';
      const environmentId = (await getRecentEnvironments(workspaceId))[0] ?? null;
      const cookieJarId = (await getRecentCookieJars(workspaceId))[0] ?? null;
      const requestId = (await getRecentRequests(workspaceId))[0] ?? null;
      const search = { cookie_jar_id: cookieJarId, environment_id: environmentId };

      if (workspaceId != null && requestId != null) {
        await navigate({
          to: '/workspaces/$workspaceId/requests/$requestId',
          params: { workspaceId, requestId },
          search,
        });
      } else {
        await navigate({
          to: '/workspaces/$workspaceId',
          params: { workspaceId },
          search,
        });
      }
    })();
  }, [navigate, recentWorkspaces, workspaces, workspaces.length]);

  return <></>;
}
