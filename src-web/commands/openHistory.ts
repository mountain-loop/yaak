import { activeWorkspaceIdAtom } from "../hooks/useActiveWorkspace";
import { createFastMutation } from "../hooks/useFastMutation";
import { jotaiStore } from "../lib/jotai";
import { router } from "../lib/router";
import { invokeCmd } from "../lib/tauri";

export const openHistory = createFastMutation<void, string, void>({
  mutationKey: ["open_history"],
  mutationFn: async () => {
    const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    if (workspaceId == null) return;

    const location = router.buildLocation({
      to: "/workspaces/$workspaceId/history",
      params: { workspaceId },
    });

    await invokeCmd("cmd_new_main_window", { url: location.href });
  },
});
