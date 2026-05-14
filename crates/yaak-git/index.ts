import { useQuery } from "@tanstack/react-query";
import { Channel, invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { createFastMutation } from "@yaakapp/yaak-client/hooks/useFastMutation";
import { queryClient } from "@yaakapp/yaak-client/lib/queryClient";
import { useMemo } from "react";
import {
  BranchDeleteResult,
  CloneResult,
  GitBranchInfo,
  GitCommit,
  GitFileDiff,
  GitRemote,
  GitStatusSummary,
  GitWorktreeStatus,
  PullResult,
  PushResult,
} from "./bindings/gen_git";
import { showToast } from "@yaakapp/yaak-client/lib/toast";

export * from "./bindings/gen_git";
export * from "./bindings/gen_models";

export interface GitCredentials {
  username: string;
  password: string;
}

export type DivergedStrategy = "force_reset" | "merge" | "cancel";

export type UncommittedChangesStrategy = "reset" | "cancel";

interface GitWatchResult {
  unlistenEvent: string;
}

export interface GitCallbacks {
  addRemote: () => Promise<GitRemote | null>;
  promptCredentials: (
    result: Extract<PushResult, { type: "needs_credentials" }>,
  ) => Promise<GitCredentials | null>;
  promptDiverged: (result: Extract<PullResult, { type: "diverged" }>) => Promise<DivergedStrategy>;
  promptUncommittedChanges: () => Promise<UncommittedChangesStrategy>;
  forceSync: () => Promise<void>;
}

const onSuccess = () => queryClient.invalidateQueries({ queryKey: ["git"] });

function gitWorktreeStatusQueryKey(dir?: string, refreshKey?: string) {
  return refreshKey == null
    ? (["git", "worktree_status", dir] as const)
    : (["git", "worktree_status", dir, refreshKey] as const);
}

export function invalidateGitWorktreeStatus(dir?: string) {
  return queryClient.invalidateQueries({ queryKey: gitWorktreeStatusQueryKey(dir) });
}

export function useGitWorktreeStatus(dir: string, refreshKey?: string) {
  return useQuery<GitWorktreeStatus, string>({
    queryKey: gitWorktreeStatusQueryKey(dir, refreshKey),
    queryFn: () => invoke("cmd_git_worktree_status", { dir }),
    placeholderData: (prev) => prev,
  });
}

export function watchGitWorktreeStatus(dir: string, callback: (status: GitWorktreeStatus) => void) {
  const channel = new Channel<GitWorktreeStatus>();
  channel.onmessage = callback;
  const unlistenPromise = invoke<GitWatchResult>("cmd_git_watch_worktree_status", {
    dir,
    channel,
  });

  void unlistenPromise
    .then(({ unlistenEvent }) => {
      addGitWatchKey(unlistenEvent);
    })
    .catch(console.debug);

  return () =>
    unlistenPromise
      .then(async ({ unlistenEvent }) => {
        unlistenGitWatcher(unlistenEvent);
      })
      .catch(console.error);
}

function useGitFetchAll(dir: string, refreshKey?: string) {
  return useQuery<void, string>({
    queryKey: ["git", "fetch_all", dir, refreshKey],
    queryFn: () => invoke("cmd_git_fetch_all", { dir }),
    refetchInterval: 10 * 60_000,
  });
}

function useGitBranchInfoQuery(dir: string, refreshKey?: string, fetchAllUpdatedAt?: number) {
  return useQuery<GitBranchInfo, string>({
    refetchOnMount: true,
    queryKey: ["git", "branch_info", dir, refreshKey, fetchAllUpdatedAt],
    queryFn: () => invoke("cmd_git_branch_info", { dir }),
    placeholderData: (prev) => prev,
  });
}

export function useGitBranchInfo(dir: string, refreshKey?: string) {
  const fetchAll = useGitFetchAll(dir, refreshKey);
  return useGitBranchInfoQuery(dir, refreshKey, fetchAll.dataUpdatedAt);
}

export function useGitLog(dir: string, refreshKey?: string, relaPath?: string) {
  return useQuery<GitCommit[], string>({
    queryKey: ["git", "log", dir, refreshKey, relaPath],
    queryFn: () =>
      relaPath == null
        ? invoke("cmd_git_log", { dir })
        : invoke("cmd_git_log_for_file", { dir, relaPath }),
    placeholderData: (prev) => prev,
  });
}

export function useGitFileDiffForCommit(
  dir: string,
  relaPath: string,
  commitOid: string | null | undefined,
) {
  return useQuery<GitFileDiff, string>({
    enabled: commitOid != null,
    queryKey: ["git", "file_diff_for_commit", dir, relaPath, commitOid],
    queryFn: () => {
      if (commitOid == null) throw new Error("Missing commit oid");
      return invoke("cmd_git_file_diff_for_commit", { dir, relaPath, commitOid });
    },
  });
}

export function useGit(dir: string, callbacks: GitCallbacks, refreshKey?: string) {
  const mutations = useGitMutations(dir, callbacks);
  const fetchAll = useGitFetchAll(dir, refreshKey);

  return [
    {
      remotes: useQuery<GitRemote[], string>({
        queryKey: ["git", "remotes", dir, refreshKey],
        queryFn: () => getRemotes(dir),
        placeholderData: (prev) => prev,
      }),
      log: useGitLog(dir, refreshKey),
      status: useQuery<GitStatusSummary, string>({
        refetchOnMount: true,
        queryKey: ["git", "status", dir, refreshKey, fetchAll.dataUpdatedAt],
        queryFn: () => invoke("cmd_git_status", { dir }),
        placeholderData: (prev) => prev,
      }),
    },
    mutations,
  ] as const;
}

export function useGitMutations(dir: string, callbacks: GitCallbacks) {
  return useMemo(() => gitMutations(dir, callbacks), [dir, callbacks]);
}

export const gitMutations = (dir: string, callbacks: GitCallbacks) => {
  const push = async () => {
    const remotes = await getRemotes(dir);
    if (remotes.length === 0) {
      const remote = await callbacks.addRemote();
      if (remote == null) throw new Error("No remote found");
    }

    const result = await invoke<PushResult>("cmd_git_push", { dir });
    if (result.type !== "needs_credentials") return result;

    // Needs credentials, prompt for them
    const creds = await callbacks.promptCredentials(result);
    if (creds == null) throw new Error("Canceled");

    await invoke("cmd_git_add_credential", {
      remoteUrl: result.url,
      username: creds.username,
      password: creds.password,
    });

    // Push again
    return invoke<PushResult>("cmd_git_push", { dir });
  };

  const handleError = (err: unknown) => {
    showToast({
      id: String(err),
      message: String(err),
      color: "danger",
      timeout: 5000,
    });
  };

  return {
    init: createFastMutation<void, string, void>({
      mutationKey: ["git", "init"],
      mutationFn: () => invoke("cmd_git_initialize", { dir }),
      onSuccess,
    }),
    add: createFastMutation<void, string, { relaPaths: string[] }>({
      mutationKey: ["git", "add", dir],
      mutationFn: (args) => invoke("cmd_git_add", { dir, ...args }),
      onSuccess,
    }),
    addRemote: createFastMutation<GitRemote, string, GitRemote>({
      mutationKey: ["git", "add-remote"],
      mutationFn: (args) => invoke("cmd_git_add_remote", { dir, ...args }),
      onSuccess,
    }),
    rmRemote: createFastMutation<void, string, { name: string }>({
      mutationKey: ["git", "rm-remote", dir],
      mutationFn: (args) => invoke("cmd_git_rm_remote", { dir, ...args }),
      onSuccess,
    }),
    createBranch: createFastMutation<void, string, { branch: string; base?: string }>({
      mutationKey: ["git", "branch", dir],
      mutationFn: (args) => invoke("cmd_git_branch", { dir, ...args }),
      onSuccess,
    }),
    mergeBranch: createFastMutation<void, string, { branch: string }>({
      mutationKey: ["git", "merge", dir],
      mutationFn: (args) => invoke("cmd_git_merge_branch", { dir, ...args }),
      onSuccess,
    }),
    deleteBranch: createFastMutation<
      BranchDeleteResult,
      string,
      { branch: string; force?: boolean }
    >({
      mutationKey: ["git", "delete-branch", dir],
      mutationFn: (args) => invoke("cmd_git_delete_branch", { dir, ...args }),
      onSuccess,
    }),
    deleteRemoteBranch: createFastMutation<void, string, { branch: string }>({
      mutationKey: ["git", "delete-remote-branch", dir],
      mutationFn: (args) => invoke("cmd_git_delete_remote_branch", { dir, ...args }),
      onSuccess,
    }),
    renameBranch: createFastMutation<void, string, { oldName: string; newName: string }>({
      mutationKey: ["git", "rename-branch", dir],
      mutationFn: (args) => invoke("cmd_git_rename_branch", { dir, ...args }),
      onSuccess,
    }),
    checkout: createFastMutation<string, string, { branch: string; force: boolean }>({
      mutationKey: ["git", "checkout", dir],
      mutationFn: (args) => invoke("cmd_git_checkout", { dir, ...args }),
      onSuccess,
    }),
    commit: createFastMutation<void, string, { message: string }>({
      mutationKey: ["git", "commit", dir],
      mutationFn: (args) => invoke("cmd_git_commit", { dir, ...args }),
      onSuccess,
    }),
    commitAndPush: createFastMutation<PushResult, string, { message: string }>({
      mutationKey: ["git", "commit_push", dir],
      mutationFn: async (args) => {
        await invoke("cmd_git_commit", { dir, ...args });
        return push();
      },
      onSuccess,
    }),

    push: createFastMutation<PushResult, string, void>({
      mutationKey: ["git", "push", dir],
      mutationFn: push,
      onSuccess,
    }),
    pull: createFastMutation<PullResult, string, void>({
      mutationKey: ["git", "pull", dir],
      async mutationFn() {
        const result = await invoke<PullResult>("cmd_git_pull", { dir });

        if (result.type === "needs_credentials") {
          const creds = await callbacks.promptCredentials(result);
          if (creds == null) throw new Error("Canceled");

          await invoke("cmd_git_add_credential", {
            remoteUrl: result.url,
            username: creds.username,
            password: creds.password,
          });

          // Pull again after credentials
          return invoke<PullResult>("cmd_git_pull", { dir });
        }

        if (result.type === "uncommitted_changes") {
          void callbacks
            .promptUncommittedChanges()
            .then(async (strategy) => {
              if (strategy === "cancel") return;

              await invoke("cmd_git_reset_changes", { dir });
              return invoke<PullResult>("cmd_git_pull", { dir });
            })
            .then(async () => {
              await onSuccess();
              await callbacks.forceSync();
            }, handleError);
        }

        if (result.type === "diverged") {
          void callbacks
            .promptDiverged(result)
            .then((strategy) => {
              if (strategy === "cancel") return;

              if (strategy === "force_reset") {
                return invoke<PullResult>("cmd_git_pull_force_reset", {
                  dir,
                  remote: result.remote,
                  branch: result.branch,
                });
              }

              return invoke<PullResult>("cmd_git_pull_merge", {
                dir,
                remote: result.remote,
                branch: result.branch,
              });
            })
            .then(async () => {
              await onSuccess();
              await callbacks.forceSync();
            }, handleError);
        }

        return result;
      },
      onSuccess,
    }),
    unstage: createFastMutation<void, string, { relaPaths: string[] }>({
      mutationKey: ["git", "unstage", dir],
      mutationFn: (args) => invoke("cmd_git_unstage", { dir, ...args }),
      onSuccess,
    }),
    resetChanges: createFastMutation<void, string, void>({
      mutationKey: ["git", "reset-changes", dir],
      mutationFn: () => invoke("cmd_git_reset_changes", { dir }),
      onSuccess,
    }),
    restore: createFastMutation<void, string, { relaPaths: string[] }>({
      mutationKey: ["git", "restore", dir],
      mutationFn: (args) => invoke("cmd_git_restore_files", { dir, ...args }),
      onSuccess,
    }),
    restoreFileFromCommit: createFastMutation<
      void,
      string,
      { commitOid: string; relaPath: string }
    >({
      mutationKey: ["git", "restore-file-from-commit", dir],
      mutationFn: (args) => invoke("cmd_git_restore_file_from_commit", { dir, ...args }),
      onSuccess,
    }),
  } as const;
};

async function getRemotes(dir: string) {
  return invoke<GitRemote[]>("cmd_git_remotes", { dir });
}

function unlistenGitWatcher(unlistenEvent: string) {
  void emit(unlistenEvent).then(() => {
    removeGitWatchKey(unlistenEvent);
  });
}

function getGitWatchKeys() {
  return sessionStorage.getItem("git-worktree-watchers")?.split(",").filter(Boolean) ?? [];
}

function setGitWatchKeys(keys: string[]) {
  sessionStorage.setItem("git-worktree-watchers", keys.join(","));
}

function addGitWatchKey(key: string) {
  const keys = getGitWatchKeys();
  setGitWatchKeys([...keys, key]);
}

function removeGitWatchKey(key: string) {
  const keys = getGitWatchKeys();
  setGitWatchKeys(keys.filter((k) => k !== key));
}

const gitWatchKeys = getGitWatchKeys();
if (gitWatchKeys.length > 0) {
  gitWatchKeys.forEach(unlistenGitWatcher);
}

/**
 * Clone a git repository, prompting for credentials if needed.
 */
export async function gitClone(
  url: string,
  dir: string,
  promptCredentials: (args: {
    url: string;
    error: string | null;
  }) => Promise<GitCredentials | null>,
): Promise<CloneResult> {
  const result = await invoke<CloneResult>("cmd_git_clone", { url, dir });
  if (result.type !== "needs_credentials") return result;

  // Prompt for credentials
  const creds = await promptCredentials({
    url: result.url,
    error: result.error,
  });
  if (creds == null) return { type: "cancelled" };

  // Store credentials and retry
  await invoke("cmd_git_add_credential", {
    remoteUrl: result.url,
    username: creds.username,
    password: creds.password,
  });

  return invoke<CloneResult>("cmd_git_clone", { url, dir });
}
