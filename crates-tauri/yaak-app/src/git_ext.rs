//! Tauri-specific extensions for yaak-git.
//!
//! This module provides the Tauri commands for git functionality.

use crate::error::Result;
use std::path::{Path, PathBuf};
use tauri::command;
use yaak_git::{
    GitCommit, GitRemote, GitStatusSummary, PullResult, PushResult, git_add, git_add_credential,
    git_add_remote, git_checkout_branch, git_commit, git_create_branch, git_delete_branch,
    git_fetch_all, git_init, git_log, git_merge_branch, git_pull, git_push, git_remotes,
    git_rm_remote, git_status, git_unstage,
};

// NOTE: All of these commands are async to prevent blocking work from locking up the UI

#[command]
pub async fn cmd_git_checkout(dir: &Path, branch: &str, force: bool) -> Result<String> {
    Ok(git_checkout_branch(dir, branch, force)?)
}

#[command]
pub async fn cmd_git_branch(dir: &Path, branch: &str) -> Result<()> {
    Ok(git_create_branch(dir, branch)?)
}

#[command]
pub async fn cmd_git_delete_branch(dir: &Path, branch: &str) -> Result<()> {
    Ok(git_delete_branch(dir, branch)?)
}

#[command]
pub async fn cmd_git_merge_branch(dir: &Path, branch: &str, force: bool) -> Result<()> {
    Ok(git_merge_branch(dir, branch, force)?)
}

#[command]
pub async fn cmd_git_status(dir: &Path) -> Result<GitStatusSummary> {
    Ok(git_status(dir)?)
}

#[command]
pub async fn cmd_git_log(dir: &Path) -> Result<Vec<GitCommit>> {
    Ok(git_log(dir)?)
}

#[command]
pub async fn cmd_git_initialize(dir: &Path) -> Result<()> {
    Ok(git_init(dir)?)
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
pub async fn cmd_git_add_credential(
    dir: &Path,
    remote_url: &str,
    username: &str,
    password: &str,
) -> Result<()> {
    Ok(git_add_credential(dir, remote_url, username, password).await?)
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
