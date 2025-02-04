import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { GitCommit, GitStatusSummary } from './bindings/gen_git';
export * from './bindings/gen_git';

export function useGit(dir: string) {
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ['git'] });

  return [
    {
      log: useQuery<void, string, GitCommit[]>({
        queryKey: ['git', 'log', dir],
        queryFn: () => invoke('plugin:yaak-git|log', { dir }),
      }),
      status: useQuery<void, string, GitStatusSummary>({
        refetchOnMount: true,
        queryKey: ['git', 'status', dir],
        queryFn: () => invoke('plugin:yaak-git|status', { dir }),
      }),
    },
    {
      add: useMutation<void, string, { relaPaths: string[] }>({
        mutationKey: ['git', 'add', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|add', { dir, ...args }),
        onSuccess,
      }),
      checkout: useMutation<void, string, void>({
        mutationKey: ['git', 'checkout', dir],
        mutationFn: () => invoke('plugin:yaak-git|checkout', { dir }),
        onSuccess,
      }),
      commit: useMutation<void, string, { message: string }>({
        mutationKey: ['git', 'commit', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|commit', { dir, ...args }),
        onSuccess,
      }),
      init: useMutation<void, string, void>({
        mutationKey: ['git', 'initialize', dir],
        mutationFn: () => invoke('plugin:yaak-git|initialize', { dir }),
        onSuccess,
      }),
      unstage: useMutation<void, string, { relaPaths: string[] }>({
        mutationKey: ['git', 'unstage', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|unstage', { dir, ...args }),
        onSuccess,
      }),
    },
  ] as const;
}
