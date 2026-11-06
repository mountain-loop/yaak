import { workspacesAtom } from "@yaakapp-internal/models";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { getRecentCookieJars } from "../hooks/useRecentCookieJars";
import { getRecentEnvironments } from "../hooks/useRecentEnvironments";
import { getRecentRequests } from "../hooks/useRecentRequests";
import { useRecentWorkspaces } from "../hooks/useRecentWorkspaces";
import { fireAndForget } from "../lib/fireAndForget";
import { router } from "../lib/router";
import { Onboarding } from "./Onboarding";

export function RedirectToLatestWorkspace() {
  const workspaces = useAtomValue(workspacesAtom);
  const recentWorkspaces = useRecentWorkspaces();

  useEffect(() => {
    if (workspaces.length === 0 || recentWorkspaces == null) {
      return;
    }

    fireAndForget(
      (async () => {
        const workspaceId = recentWorkspaces[0] ?? workspaces[0]?.id ?? "n/a";
        const environmentId = (await getRecentEnvironments(workspaceId))[0] ?? null;
        const cookieJarId = (await getRecentCookieJars(workspaceId))[0] ?? null;
        const requestId = (await getRecentRequests(workspaceId))[0] ?? null;
        const params = { workspaceId };
        const search = {
          cookie_jar_id: cookieJarId,
          environment_id: environmentId,
          request_id: requestId,
        };

        // Whatever created the first workspace may have already navigated into it
        const currentId = router.history.location.pathname.match(/^\/workspaces\/([^/]+)/)?.[1];
        if (workspaces.some((w) => w.id === currentId)) return;

        console.log("Redirecting to workspace", params, search);
        await router.navigate({ to: "/workspaces/$workspaceId", params, search });
      })(),
    );
  }, [recentWorkspaces, workspaces, workspaces.length]);

  // The global models are loaded before the router mounts, so an empty list is a real
  // first launch (or the last workspace was just deleted), not a store still loading
  if (workspaces.length === 0) {
    return <Onboarding />;
  }

  return null;
}
