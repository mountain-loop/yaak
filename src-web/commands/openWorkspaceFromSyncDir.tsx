import { applySync, calculateSyncFsOnly } from "@yaakapp-internal/sync";
import { createFastMutation } from "../hooks/useFastMutation";
import { showSimpleAlert } from "../lib/alert";
import { router } from "../lib/router";

export const openWorkspaceFromSyncDir = createFastMutation<void, void, string>({
  mutationKey: [],
  mutationFn: async (dir) => {
    const ops = await calculateSyncFsOnly(dir);

    const workspace = ops
      .map((o) => (o.type === "dbCreate" && o.fs.model.type === "workspace" ? o.fs.model : null))
      .filter((m) => m)[0];

    if (workspace == null) {
      showSimpleAlert(
        "Не удалось открыть",
        "В выбранной папке не найдено ни одного рабочего пространства",
      );
      return;
    }

    await applySync(workspace.id, dir, ops);

    await router.navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: workspace.id },
    });
  },
});
