import { useMutation } from "@tanstack/react-query";
import { uninstallPlugin } from "@yaakapp-internal/plugins";
import { InlineCode } from "@yaakapp-internal/ui";
import { showConfirmDelete } from "../lib/confirm";
import { minPromiseMillis } from "../lib/minPromiseMillis";

/** Confirms, then uninstalls. Null until there is a plugin to uninstall. */
export function usePromptUninstallPlugin(pluginId: string | null, name: string) {
  const mut = useMutation({
    mutationKey: ["uninstall_plugin", pluginId],
    mutationFn: async () => {
      if (pluginId == null) return;

      const confirmed = await showConfirmDelete({
        id: `uninstall-plugin-${pluginId}`,
        title: "Uninstall Plugin",
        confirmText: "Uninstall",
        description: (
          <>
            Permanently uninstall <InlineCode>{name}</InlineCode>?
          </>
        ),
      });
      if (confirmed) {
        await minPromiseMillis(uninstallPlugin(pluginId), 700);
      }
    },
  });

  return pluginId == null ? null : mut;
}
