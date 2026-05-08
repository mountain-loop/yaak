import { watchGitWorktreeStatus, type GitWorktreeStatusEntry } from "@yaakapp-internal/git";
import { activeWorkspaceMetaAtom } from "../hooks/useActiveWorkspace";
import { gitWorktreeStatusByModelIdAtom } from "../lib/gitWorktreeStatus";
import { jotaiStore } from "../lib/jotai";

export function initGit() {
  let watchedDir: string | null = null;
  let unwatch: null | ReturnType<typeof watchGitWorktreeStatus> = null;

  const watchActiveWorkspace = () => {
    const syncDir = jotaiStore.get(activeWorkspaceMetaAtom)?.settingSyncDir ?? null;
    if (syncDir === watchedDir) return;

    void unwatch?.();
    unwatch = null;
    watchedDir = syncDir;
    jotaiStore.set(gitWorktreeStatusByModelIdAtom, {});

    if (syncDir == null) return;

    unwatch = watchGitWorktreeStatus(syncDir, (status) => {
      if (syncDir !== watchedDir) return;

      const statusByModelId: Record<string, GitWorktreeStatusEntry> = {};
      for (const entry of status.entries) {
        if (entry.modelId == null) continue;
        statusByModelId[entry.modelId] = entry;
      }
      jotaiStore.set(gitWorktreeStatusByModelIdAtom, statusByModelId);
    });
  };

  watchActiveWorkspace();
  jotaiStore.sub(activeWorkspaceMetaAtom, watchActiveWorkspace);
}
