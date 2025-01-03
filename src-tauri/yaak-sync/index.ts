import { invoke } from '@tauri-apps/api/core';
import { ModelPayload, Workspace } from '@yaakapp-internal/models';
import { useListenToTauriEvent } from '@yaakapp/app/hooks/useListenToTauriEvent';
import { debounce } from '@yaakapp/app/lib/debounce';
import { useEffect } from 'react';

const sync = async (workspace: Workspace) => {
  if (workspace == null || !workspace.settingSyncDir) return;
  console.log('Syncing', workspace.settingSyncDir, workspace.id);
  await invoke('plugin:yaak-sync|sync', {
    workspaceId: workspace.id,
    dir: workspace.settingSyncDir,
  });
};

const debouncedSync = debounce(sync, 2000);

export function useSyncActiveWorkspaceDir(workspace: Workspace | null) {
  useEffect(() => {
    if (workspace == null) return;
    const t = setInterval(() => debouncedSync(workspace), 5000);
    return () => clearInterval(t);
  }, [workspace]);

  useListenToTauriEvent<ModelPayload>('upserted_model', () => debouncedSync(workspace));
  useListenToTauriEvent<ModelPayload>('deleted_model', () => debouncedSync(workspace));
}
