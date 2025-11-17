import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { GitCommit, GitRemote, GitStatusSummary, PullResult, PushResult } from './bindings/gen_git';

export * from './bindings/gen_git';

export interface GitCredentials {
  username: string;
  password: string;
}

export interface GitCallbacks {
  promptCredentials: (
    result: Extract<PushResult, { type: 'needs_credentials' }>,
  ) => Promise<null | GitCredentials>;
}

export function useGit(dir: string, callbacks: GitCallbacks) {
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ['git'] });

  return [
    {
      remotes: useQuery<void, string, GitRemote[]>({
        queryKey: ['git', 'remotes', dir],
        queryFn: () => invoke('plugin:yaak-git|remotes', { dir }),
      }),
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
      addRemote: useMutation<void, string, { name: string; url: string }>({
        mutationKey: ['git', 'add-remote', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|add_remote', { dir, ...args }),
        onSuccess,
      }),
      rmRemote: useMutation<void, string, { name: string }>({
        mutationKey: ['git', 'rm-remote', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|rm_remote', { dir, ...args }),
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
      checkout: useMutation<string, string, { branch: string; force: boolean }>({
        mutationKey: ['git', 'checkout', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|checkout', { dir, ...args }),
        onSuccess,
      }),
      commit: useMutation<void, string, { message: string }>({
        mutationKey: ['git', 'commit', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|commit', { dir, ...args }),
        onSuccess,
      }),
      commitAndPush: useMutation<PushResult, string, { message: string }>({
        mutationKey: ['git', 'commit_push', dir],
        mutationFn: async (args) => {
          await invoke('plugin:yaak-git|commit', { dir, ...args });
          return invoke('plugin:yaak-git|push', { dir });
        },
        onSuccess,
      }),
      fetchAll: useMutation<string, string, void>({
        mutationKey: ['git', 'checkout', dir],
        mutationFn: () => invoke('plugin:yaak-git|fetch_all', { dir }),
        onSuccess,
      }),
      push: useMutation<PushResult, string, void>({
        mutationKey: ['git', 'push', dir],
        mutationFn: async () => {
          const result = await invoke<PushResult>('plugin:yaak-git|push', { dir });
          if (result.type !== 'needs_credentials') return result;

          // Needs credentials, prompt for them
          const creds = await callbacks.promptCredentials(result);
          if (creds == null) throw new Error('Canceled');

          await invoke('plugin:yaak-git|add_credential', {
            dir,
            remoteUrl: result.url,
            username: creds.username,
            password: creds.password,
          });

          // Push again
          return invoke<PushResult>('plugin:yaak-git|push', { dir });
        },
        onSuccess,
      }),
      pull: useMutation<PullResult, string, void>({
        mutationKey: ['git', 'pull', dir],
        async mutationFn() {
          const result = await invoke<PullResult>('plugin:yaak-git|pull', { dir });
          if (result.type !== 'needs_credentials') return result;

          // Needs credentials, prompt for them
          const creds = await callbacks.promptCredentials(result);
          if (creds == null) throw new Error('Canceled');

          await invoke('plugin:yaak-git|add_credential', {
            dir,
            remoteUrl: result.url,
            username: creds.username,
            password: creds.password,
          });

          // Pull again
          return invoke<PushResult>('plugin:yaak-git|pull', { dir });
        },
        onSuccess,
      }),
      unstage: useMutation<void, string, { relaPaths: string[] }>({
        mutationKey: ['git', 'unstage', dir],
        mutationFn: (args) => invoke('plugin:yaak-git|unstage', { dir, ...args }),
        onSuccess,
      }),
      init: useGitInit(),
    },
  ] as const;
}

export function useGitInit() {
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ['git'] });

  return useMutation<void, string, { dir: string }>({
    mutationKey: ['git', 'init'],
    mutationFn: (args) => invoke('plugin:yaak-git|initialize', { ...args }),
    onSuccess,
  });
}
