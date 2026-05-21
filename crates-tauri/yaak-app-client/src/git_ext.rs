//! Tauri-specific extensions for yaak-git.
//!
//! This module provides the Tauri commands for git functionality.

use crate::error::Result;
use crate::git_watcher::{GitWatchResult, watch_git_worktree_status};
use std::path::{Path, PathBuf};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, command};
use yaak_git::{
    BranchDeleteResult, CloneResult, GitBranchInfo, GitCommit, GitFileDiff, GitRemote,
    GitStatusSummary, GitWorktreeStatus, PullResult, PushResult, git_add, git_add_credential,
    git_add_remote, git_branch_info, git_checkout_branch, git_clone, git_commit, git_create_branch,
    git_delete_branch, git_delete_remote_branch, git_fetch_all, git_file_diff_for_commit, git_init,
    git_log, git_log_for_file, git_merge_branch, git_pull, git_pull_force_reset, git_pull_merge,
    git_push, git_remotes, git_rename_branch, git_reset_changes, git_restore,
    git_restore_file_from_commit, git_rm_remote, git_status, git_unstage, git_worktree_status,
};

// NOTE: All of these commands are async to prevent blocking work from locking up the UI

#[command]
pub async fn cmd_git_checkout(dir: &Path, branch: &str, force: bool) -> Result<String> {
    Ok(git_checkout_branch(dir, branch, force).await?)
}

#[command]
pub async fn cmd_git_branch(dir: &Path, branch: &str, base: Option<&str>) -> Result<()> {
    Ok(git_create_branch(dir, branch, base).await?)
}

#[command]
pub async fn cmd_git_delete_branch(
    dir: &Path,
    branch: &str,
    force: Option<bool>,
) -> Result<BranchDeleteResult> {
    Ok(git_delete_branch(dir, branch, force.unwrap_or(false)).await?)
}

#[command]
pub async fn cmd_git_delete_remote_branch(dir: &Path, branch: &str) -> Result<()> {
    Ok(git_delete_remote_branch(dir, branch).await?)
}

#[command]
pub async fn cmd_git_merge_branch(dir: &Path, branch: &str) -> Result<()> {
    Ok(git_merge_branch(dir, branch).await?)
}

#[command]
pub async fn cmd_git_rename_branch(dir: &Path, old_name: &str, new_name: &str) -> Result<()> {
    Ok(git_rename_branch(dir, old_name, new_name).await?)
}

#[command]
pub async fn cmd_git_status(dir: &Path) -> Result<GitStatusSummary> {
    Ok(git_status(dir)?)
}

#[command]
pub async fn cmd_git_branch_info(dir: &Path) -> Result<GitBranchInfo> {
    Ok(git_branch_info(dir)?)
}

#[command]
pub async fn cmd_git_worktree_status(dir: &Path) -> Result<GitWorktreeStatus> {
    Ok(git_worktree_status(dir)?)
}

#[command]
pub async fn cmd_git_watch_worktree_status<R: Runtime>(
    app_handle: AppHandle<R>,
    dir: &Path,
    channel: Channel<GitWorktreeStatus>,
) -> Result<GitWatchResult> {
    watch_git_worktree_status(app_handle, dir, channel).await
}

#[command]
pub async fn cmd_git_log(dir: &Path) -> Result<Vec<GitCommit>> {
    Ok(git_log(dir)?)
}

#[command]
pub async fn cmd_git_log_for_file(dir: &Path, rela_path: PathBuf) -> Result<Vec<GitCommit>> {
    Ok(git_log_for_file(dir, &rela_path)?)
}

#[command]
pub async fn cmd_git_file_diff_for_commit(
    dir: &Path,
    commit_oid: &str,
    rela_path: PathBuf,
) -> Result<GitFileDiff> {
    Ok(git_file_diff_for_commit(dir, commit_oid, &rela_path)?)
}

#[command]
pub async fn cmd_git_initialize(dir: &Path) -> Result<()> {
    Ok(git_init(dir)?)
}

#[command]
pub async fn cmd_git_clone(url: &str, dir: &Path) -> Result<CloneResult> {
    Ok(git_clone(url, dir).await?)
}

#[command]
pub async fn cmd_git_commit(dir: &Path, message: &str) -> Result<()> {
    Ok(git_commit(dir, message).await?)
}

#[command]
pub async fn cmd_git_fetch_all(dir: &Path) -> Result<()> {
    Ok(git_fetch_all(dir).await?)
}

#[command]
pub async fn cmd_git_push(dir: &Path) -> Result<PushResult> {
    Ok(git_push(dir).await?)
}

#[command]
pub async fn cmd_git_pull(dir: &Path) -> Result<PullResult> {
    Ok(git_pull(dir).await?)
}

#[command]
pub async fn cmd_git_pull_force_reset(
    dir: &Path,
    remote: &str,
    branch: &str,
) -> Result<PullResult> {
    Ok(git_pull_force_reset(dir, remote, branch).await?)
}

#[command]
pub async fn cmd_git_pull_merge(dir: &Path, remote: &str, branch: &str) -> Result<PullResult> {
    Ok(git_pull_merge(dir, remote, branch).await?)
}

#[command]
pub async fn cmd_git_add(dir: &Path, rela_paths: Vec<PathBuf>) -> Result<()> {
    for path in rela_paths {
        git_add(dir, &path)?;
    }
    Ok(())
}

#[command]
pub async fn cmd_git_unstage(dir: &Path, rela_paths: Vec<PathBuf>) -> Result<()> {
    for path in rela_paths {
        git_unstage(dir, &path)?;
    }
    Ok(())
}

#[command]
pub async fn cmd_git_reset_changes(dir: &Path) -> Result<()> {
    Ok(git_reset_changes(dir).await?)
}

#[command]
pub async fn cmd_git_restore_files(dir: &Path, rela_paths: Vec<PathBuf>) -> Result<()> {
    for path in rela_paths {
        git_restore(dir, &path)?;
    }
    Ok(())
}

#[command]
pub async fn cmd_git_restore_file_from_commit(
    dir: &Path,
    commit_oid: &str,
    rela_path: PathBuf,
) -> Result<()> {
    Ok(git_restore_file_from_commit(dir, commit_oid, &rela_path)?)
}

#[command]
pub async fn cmd_git_add_credential(
    remote_url: &str,
    username: &str,
    password: &str,
) -> Result<()> {
    Ok(git_add_credential(remote_url, username, password).await?)
}

#[command]
pub async fn cmd_git_remotes(dir: &Path) -> Result<Vec<GitRemote>> {
    Ok(git_remotes(dir)?)
}

#[command]
pub async fn cmd_git_add_remote(dir: &Path, name: &str, url: &str) -> Result<GitRemote> {
    Ok(git_add_remote(dir, name, url)?)
}

#[command]
pub async fn cmd_git_rm_remote(dir: &Path, name: &str) -> Result<()> {
    Ok(git_rm_remote(dir, name)?)
}
