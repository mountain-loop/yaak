import { invoke } from '@tauri-apps/api/core';
import { ModelPayload } from '@yaakapp-internal/models';
import { useActiveWorkspace } from '@yaakapp/app/hooks/useActiveWorkspace';
import { useListenToTauriEvent } from '@yaakapp/app/hooks/useListenToTauriEvent';
import { debounce } from '@yaakapp/app/lib/debounce';
import { useEffect } from 'react';

const sync = async (workspaceId: string | undefined, dir: string) => {
  if (workspaceId == null) return;
  console.log('Syncing', dir, workspaceId);
  await invoke('plugin:yaak-git|sync', { workspaceId, dir });
};
const debouncedSync = debounce(sync, 2000);

export function useGit(dir: string) {
  const workspaceId = useActiveWorkspace()?.id;

  useEffect(() => {
    const t = setInterval(() => debouncedSync(workspaceId, dir), 5000);
    return () => clearInterval(t);
  }, [dir]);

  useListenToTauriEvent<ModelPayload>('upserted_model', () => debouncedSync(workspaceId, dir));
  useListenToTauriEvent<ModelPayload>('deleted_model', () => debouncedSync(workspaceId, dir));
}
