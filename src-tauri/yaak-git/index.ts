import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { GitCommit, GitStatusSummary, PullResult, PushResult } from './bindings/gen_git';

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
      branch: useMutation<void, string, { branch: string }>({
        mutationKey: ['git', 'branch', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|branch', { dir, ...args }),
        onSuccess,
      }),
      mergeBranch: useMutation<void, string, { branch: string; force: boolean }>({
        mutationKey: ['git', 'merge', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|merge_branch', { dir, ...args }),
        onSuccess,
      }),
      deleteBranch: useMutation<void, string, { branch: string }>({
        mutationKey: ['git', 'delete-branch', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|delete_branch', { dir, ...args }),
        onSuccess,
      }),
      checkout: useMutation<void, string, { branch: string; force: boolean }>({
        mutationKey: ['git', 'checkout', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|checkout', { dir, ...args }),
        onSuccess,
      }),
      commit: useMutation<void, string, { message: string }>({
        mutationKey: ['git', 'commit', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|commit', { dir, ...args }),
        onSuccess,
      }),
      push: useMutation<PushResult, string, void>({
        mutationKey: ['git', 'push', dir],
        mutationFn: () => invoke('plugin:yaak-git|push', { dir }),
        onSuccess,
      }),
      pull: useMutation<PullResult, string, void>({
        mutationKey: ['git', 'pull', dir],
        mutationFn: () => invoke('plugin:yaak-git|pull', { dir }),
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

export async function gitInit(dir: string) {
  await invoke('plugin:yaak-git|initialize', { dir });
}
