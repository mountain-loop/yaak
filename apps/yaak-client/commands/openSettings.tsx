import { platform } from "@yaakapp-internal/platform";
import type { SettingsTab, SettingsTabWithSubtab } from "../components/Settings/Settings";
import { activeWorkspaceIdAtom } from "../hooks/useActiveWorkspace";
import { createFastMutation } from "../hooks/useFastMutation";
import { showDialog } from "../lib/dialog";
import { jotaiStore } from "../lib/jotai";
import { router } from "../lib/router";
import { rpc } from "../lib/rpc";

export const openSettings = createFastMutation<void, string, SettingsTabWithSubtab | null>({
  mutationKey: ["open_settings"],
  mutationFn: async (tab) => {
    const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    if (workspaceId == null) return;

    // Settings is its own window where the host has windows to give. Where it
    // doesn't — a browser tab — it's a dialog like any other, so opening it
    // doesn't take you away from the request you were working on.
    if (!platform.capabilities.multiWindow) {
      // Imported here so Settings stays out of the startup bundle, the way the
      // route that renders it on desktop already keeps it
      const { default: Settings } = await import("../components/Settings/Settings");
      showDialog({
        id: "settings",
        size: "md",
        className: "h-[calc(100vh-5rem)] max-h-150! overflow-hidden",
        noPadding: true,
        noScroll: true,
        // Keyed so opening a specific tab while the dialog is already up moves to it
        render: ({ hide }) => <Settings key={tab ?? "general"} tab={tab} hide={hide} />,
      });
      return;
    }

    const location = router.buildLocation({
      to: "/workspaces/$workspaceId/settings",
      params: { workspaceId },
      search: { tab: (tab ?? undefined) as SettingsTab | undefined },
    });

    await rpc("cmd_new_child_window", {
      url: location.href,
      label: "settings",
      title: "Yaak Settings",
      innerSize: [750, 600],
    });
  },
});
