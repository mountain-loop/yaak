import { platform } from "@yaakapp-internal/platform";
import type { SettingsTab } from "../components/Settings/Settings";
import { activeWorkspaceIdAtom } from "../hooks/useActiveWorkspace";
import { createFastMutation } from "../hooks/useFastMutation";
import { jotaiStore } from "../lib/jotai";
import { router } from "../lib/router";
import { rpc } from "../lib/rpc";

// Allow tab with optional subtab (e.g., "plugins:installed")
type SettingsTabWithSubtab = SettingsTab | `${SettingsTab}:${string}` | null;

export const openSettings = createFastMutation<void, string, SettingsTabWithSubtab>({
  mutationKey: ["open_settings"],
  mutationFn: async (tab) => {
    const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    if (workspaceId == null) return;

    const to = "/workspaces/$workspaceId/settings" as const;
    const params = { workspaceId };
    const search = { tab: (tab ?? undefined) as SettingsTab | undefined };

    // Settings is its own window where the host has windows to give. Where it
    // doesn't — a browser tab — the same route opens in place, which is the
    // whole difference: it is already a route, not a separate app.
    if (!platform.capabilities.multiWindow) {
      await router.navigate({ to, params, search });
      return;
    }

    const location = router.buildLocation({ to, params, search });

    await rpc("cmd_new_child_window", {
      url: location.href,
      label: "settings",
      title: "Yaak Settings",
      innerSize: [750, 600],
    });
  },
});
