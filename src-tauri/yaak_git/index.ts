import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import type { ModelPayload } from '@yaakapp-internal/models';
import { useActiveWorkspace } from '@yaakapp/app/hooks/useActiveWorkspace';
import { useListenToTauriEvent } from '@yaakapp/app/hooks/useListenToTauriEvent';
import { debounce } from '@yaakapp/app/lib/debounce';
import { useEffect } from 'react';
import { GitCommit, GitStatusEntry } from './bindings/git';

const sync = async (workspaceId: string | undefined, dir: string) => {
  if (workspaceId == null) return;
  console.log('Syncing', dir, workspaceId);
  await invoke('plugin:yaak-git|sync', { workspaceId, dir });
};
const debouncedSync = debounce(sync, 2000);

export function useGit(dir: string) {
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ['sync', 'git'] });
  const workspaceId = useActiveWorkspace()?.id;

  useEffect(() => {
    const t = setInterval(() => debouncedSync(workspaceId, dir), 5000);
    return () => clearInterval(t);
  }, [dir]);

  useListenToTauriEvent<ModelPayload>('upserted_model', () => debouncedSync(workspaceId, dir));
  useListenToTauriEvent<ModelPayload>('deleted_model', () => debouncedSync(workspaceId, dir));

  return [
    {
      log: useQuery<void, string, GitCommit[]>({
        queryKey: ['sync', 'git', 'log', dir],
        queryFn: () => invoke('plugin:yaak-git|log', { dir }),
      }),
      status: useQuery<void, string, GitStatusEntry[]>({
        refetchOnMount: true,
        queryKey: ['sync', 'git', 'status', dir],
        queryFn: () => invoke('plugin:yaak-git|status', { dir }),
      }),
    },
    {
      add: useMutation<void, string, { relaPath: string }>({
        mutationKey: ['sync', 'git', 'add', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|add', { dir, ...args }),
        onSuccess,
      }),
      checkout: useMutation<void, string, void>({
        mutationKey: ['sync', 'git', 'checkout', dir],
        mutationFn: () => invoke('plugin:yaak-git|checkout', { dir }),
        onSuccess,
      }),
      commit: useMutation<void, string, { message: string }>({
        mutationKey: ['sync', 'git', 'commit', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|commit', { dir, ...args }),
        onSuccess,
      }),
      init: useMutation<void, string, void>({
        mutationKey: ['sync', 'git', 'initialize', dir],
        mutationFn: () => invoke('plugin:yaak-git|initialize', { dir }),
        onSuccess,
      }),
      unstage: useMutation<void, string, { relaPath: string }>({
        mutationKey: ['sync', 'git', 'unstage', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|unstage', { dir, ...args }),
        onSuccess,
      }),
    },
  ] as const;
}
