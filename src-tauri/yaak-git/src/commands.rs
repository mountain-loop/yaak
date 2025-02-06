use crate::branch::{git_checkout_branch, git_create_branch, git_delete_branch, git_merge_branch};
use crate::error::Result;
use crate::git::{
    git_add, git_commit, git_init, git_log, git_status, git_unstage, GitCommit, GitStatusSummary,
};
use crate::pull::{git_pull, PullResult};
use crate::push::{git_push, PushResult};
use std::path::{Path, PathBuf};
use tauri::command;
// NOTE: All of these commands are async to prevent blocking work from locking up the UI

#[command]
pub async fn checkout(dir: &Path, branch: &str, force: bool) -> Result<()> {
    git_checkout_branch(dir, branch, force)
}

#[command]
pub async fn branch(dir: &Path, branch: &str) -> Result<()> {
    git_create_branch(dir, branch)
}

#[command]
pub async fn delete_branch(dir: &Path, branch: &str) -> Result<()> {
    git_delete_branch(dir, branch)
}

#[command]
pub async fn merge_branch(dir: &Path, branch: &str, force: bool) -> Result<()> {
    git_merge_branch(dir, branch, force)
}

#[command]
pub async fn status(dir: &Path) -> Result<GitStatusSummary> {
    git_status(dir)
}

#[command]
pub async fn log(dir: &Path) -> Result<Vec<GitCommit>> {
    git_log(dir)
}

#[command]
pub async fn initialize(dir: &Path) -> Result<()> {
    git_init(dir)
}

#[command]
pub async fn commit(dir: &Path, message: &str) -> Result<()> {
    git_commit(dir, message)
}

#[command]
pub async fn push(dir: &Path) -> Result<PushResult> {
    git_push(dir)
}

#[command]
pub async fn pull(dir: &Path) -> Result<PullResult> {
    git_pull(dir)
}

#[command]
pub async fn add(dir: &Path, rela_paths: Vec<PathBuf>) -> Result<()> {
    for path in rela_paths {
        git_add(dir, &path)?;
    }
    Ok(())
}

#[command]
pub async fn unstage(dir: &Path, rela_paths: Vec<PathBuf>) -> Result<()> {
    for path in rela_paths {
        git_unstage(dir, &path)?;
    }
    Ok(())
}
