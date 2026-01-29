import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { createFastMutation } from '@yaakapp/app/hooks/useFastMutation';
import { queryClient } from '@yaakapp/app/lib/queryClient';
import { useMemo } from 'react';
import { BranchDeleteResult, CloneResult, GitCommit, GitRemote, GitStatusSummary, PullResult, PushResult } from './bindings/gen_git';

export * from './bindings/gen_git';
export * from './bindings/gen_models';

export interface GitCredentials {
  username: string;
  password: string;
}

export interface GitCallbacks {
  addRemote: () => Promise<GitRemote | null>;
  promptCredentials: (
    result: Extract<PushResult, { type: 'needs_credentials' }>,
  ) => Promise<GitCredentials | null>;
}

const onSuccess = () => queryClient.invalidateQueries({ queryKey: ['git'] });

export function useGit(dir: string, callbacks: GitCallbacks) {
  const mutations = useMemo(() => gitMutations(dir, callbacks), [dir, callbacks]);
  return [
    {
      remotes: useQuery<GitRemote[], string>({
        queryKey: ['git', 'remotes', dir],
        queryFn: () => getRemotes(dir),
      }),
      log: useQuery<GitCommit[], string>({
        queryKey: ['git', 'log', dir],
        queryFn: () => invoke('cmd_git_log', { dir }),
      }),
      status: useQuery<GitStatusSummary, string>({
        refetchOnMount: true,
        queryKey: ['git', 'status', dir],
        queryFn: () => invoke('cmd_git_status', { dir }),
      }),
    },
    mutations,
  ] as const;
}

export const gitMutations = (dir: string, callbacks: GitCallbacks) => {
  const push = async () => {
    const remotes = await getRemotes(dir);
    if (remotes.length === 0) {
      const remote = await callbacks.addRemote();
      if (remote == null) throw new Error('No remote found');
    }

    const result = await invoke<PushResult>('cmd_git_push', { dir });
    if (result.type !== 'needs_credentials') return result;

    // Needs credentials, prompt for them
    const creds = await callbacks.promptCredentials(result);
    if (creds == null) throw new Error('Canceled');

    await invoke('cmd_git_add_credential', {
      remoteUrl: result.url,
      username: creds.username,
      password: creds.password,
    });

    // Push again
    return invoke<PushResult>('cmd_git_push', { dir });
  };

  return {
    init: createFastMutation<void, string, void>({
      mutationKey: ['git', 'init'],
      mutationFn: () => invoke('cmd_git_initialize', { dir }),
      onSuccess,
    }),
    add: createFastMutation<void, string, { relaPaths: string[] }>({
      mutationKey: ['git', 'add', dir],
      mutationFn: (args) => invoke('cmd_git_add', { dir, ...args }),
      onSuccess,
    }),
    addRemote: createFastMutation<GitRemote, string, GitRemote>({
      mutationKey: ['git', 'add-remote'],
      mutationFn: (args) => invoke('cmd_git_add_remote', { dir, ...args }),
      onSuccess,
    }),
    rmRemote: createFastMutation<void, string, { name: string }>({
      mutationKey: ['git', 'rm-remote', dir],
      mutationFn: (args) => invoke('cmd_git_rm_remote', { dir, ...args }),
      onSuccess,
    }),
    createBranch: createFastMutation<void, string, { branch: string; base?: string }>({
      mutationKey: ['git', 'branch', dir],
      mutationFn: (args) => invoke('cmd_git_branch', { dir, ...args }),
      onSuccess,
    }),
    mergeBranch: createFastMutation<void, string, { branch: string }>({
      mutationKey: ['git', 'merge', dir],
      mutationFn: (args) => invoke('cmd_git_merge_branch', { dir, ...args }),
      onSuccess,
    }),
    deleteBranch: createFastMutation<BranchDeleteResult, string, { branch: string, force?: boolean }>({
      mutationKey: ['git', 'delete-branch', dir],
      mutationFn: (args) => invoke('cmd_git_delete_branch', { dir, ...args }),
      onSuccess,
    }),
    deleteRemoteBranch: createFastMutation<void, string, { branch: string }>({
      mutationKey: ['git', 'delete-remote-branch', dir],
      mutationFn: (args) => invoke('cmd_git_delete_remote_branch', { dir, ...args }),
      onSuccess,
    }),
    renameBranch: createFastMutation<void, string, { oldName: string, newName: string }>({
      mutationKey: ['git', 'rename-branch', dir],
      mutationFn: (args) => invoke('cmd_git_rename_branch', { dir, ...args }),
      onSuccess,
    }),
    checkout: createFastMutation<string, string, { branch: string; force: boolean }>({
      mutationKey: ['git', 'checkout', dir],
      mutationFn: (args) => invoke('cmd_git_checkout', { dir, ...args }),
      onSuccess,
    }),
    commit: createFastMutation<void, string, { message: string }>({
      mutationKey: ['git', 'commit', dir],
      mutationFn: (args) => invoke('cmd_git_commit', { dir, ...args }),
      onSuccess,
    }),
    commitAndPush: createFastMutation<PushResult, string, { message: string }>({
      mutationKey: ['git', 'commit_push', dir],
      mutationFn: async (args) => {
        await invoke('cmd_git_commit', { dir, ...args });
        return push();
      },
      onSuccess,
    }),
    fetchAll: createFastMutation<string, string, void>({
      mutationKey: ['git', 'checkout', dir],
      mutationFn: () => invoke('cmd_git_fetch_all', { dir }),
      onSuccess,
    }),
    push: createFastMutation<PushResult, string, void>({
      mutationKey: ['git', 'push', dir],
      mutationFn: push,
      onSuccess,
    }),
    pull: createFastMutation<PullResult, string, void>({
      mutationKey: ['git', 'pull', dir],
      async mutationFn() {
        const result = await invoke<PullResult>('cmd_git_pull', { dir });
        if (result.type !== 'needs_credentials') return result;

        // Needs credentials, prompt for them
        const creds = await callbacks.promptCredentials(result);
        if (creds == null) throw new Error('Canceled');

        await invoke('cmd_git_add_credential', {
          remoteUrl: result.url,
          username: creds.username,
          password: creds.password,
        });

        // Pull again
        return invoke<PullResult>('cmd_git_pull', { dir });
      },
      onSuccess,
    }),
    unstage: createFastMutation<void, string, { relaPaths: string[] }>({
      mutationKey: ['git', 'unstage', dir],
      mutationFn: (args) => invoke('cmd_git_unstage', { dir, ...args }),
      onSuccess,
    }),
  } as const;
};

async function getRemotes(dir: string) {
  return invoke<GitRemote[]>('cmd_git_remotes', { dir });
}

/**
 * Clone a git repository, prompting for credentials if needed.
 */
export async function gitClone(
  url: string,
  dir: string,
  promptCredentials: (args: { url: string; error: string | null }) => Promise<GitCredentials | null>,
): Promise<CloneResult> {
  const result = await invoke<CloneResult>('cmd_git_clone', { url, dir });
  if (result.type !== 'needs_credentials') return result;

  // Prompt for credentials
  const creds = await promptCredentials({ url: result.url, error: result.error });
  if (creds == null) return {type: 'cancelled'};

  // Store credentials and retry
  await invoke('cmd_git_add_credential', {
    remoteUrl: result.url,
    username: creds.username,
    password: creds.password,
  });

  return invoke<CloneResult>('cmd_git_clone', { url, dir });
}
