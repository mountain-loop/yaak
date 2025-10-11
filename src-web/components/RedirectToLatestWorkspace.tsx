import { workspacesAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { getRecentCookieJars } from '../hooks/useRecentCookieJars';
import { getRecentEnvironments } from '../hooks/useRecentEnvironments';
import { getRecentRequests } from '../hooks/useRecentRequests';
import { useRecentWorkspaces } from '../hooks/useRecentWorkspaces';
import { router } from '../lib/router';

export function RedirectToLatestWorkspace() {
  const workspaces = useAtomValue(workspacesAtom);
  const recentWorkspaces = useRecentWorkspaces();

  useEffect(() => {
    if (workspaces.length === 0 || recentWorkspaces == null) {
      console.log('No workspaces found to redirect to. Skipping.', {
        workspaces,
        recentWorkspaces,
      });
      return;
    }

    (async function () {
      const workspaceId = recentWorkspaces[0] ?? workspaces[0]?.id ?? 'n/a';
      const environmentId = (await getRecentEnvironments(workspaceId))[0] ?? null;
      const cookieJarId = (await getRecentCookieJars(workspaceId))[0] ?? null;
      const requestId = (await getRecentRequests(workspaceId))[0] ?? null;
      const params = { workspaceId };
      const search = {
        cookie_jar_id: cookieJarId,
        environment_id: environmentId,
        request_id: requestId,
      };

      console.log('Redirecting to workspace', params, search);
      await router.navigate({ to: '/workspaces/$workspaceId', params, search });
    })();
  }, [recentWorkspaces, workspaces, workspaces.length]);

  return <></>;
}
