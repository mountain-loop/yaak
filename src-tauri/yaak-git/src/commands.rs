use crate::add::git_add;
use crate::branch::{git_checkout_branch, git_create_branch, git_delete_branch, git_merge_branch};
use crate::commit::git_commit;
use crate::credential::git_add_credential;
use crate::error::Result;
use crate::fetch::git_fetch_all;
use crate::init::git_init;
use crate::log::{GitCommit, git_log};
use crate::pull::{PullResult, git_pull};
use crate::push::{PushResult, git_push};
use crate::remotes::{GitRemote, git_add_remote, git_remotes, git_rm_remote};
use crate::status::{GitStatusSummary, git_status};
use crate::unstage::git_unstage;
use std::path::{Path, PathBuf};
use tauri::command;

// NOTE: All of these commands are async to prevent blocking work from locking up the UI

#[command]
pub async fn checkout(dir: &Path, branch: &str, force: bool) -> Result<String> {
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
pub async fn fetch_all(dir: &Path) -> Result<()> {
    git_fetch_all(dir)
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

#[command]
pub async fn add_credential(
    dir: &Path,
    remote_url: &str,
    username: &str,
    password: &str,
) -> Result<()> {
    git_add_credential(dir, remote_url, username, password).await
}

#[command]
pub async fn remotes(dir: &Path) -> Result<Vec<GitRemote>> {
    git_remotes(dir)
}

#[command]
pub async fn add_remote(dir: &Path, name: &str, url: &str) -> Result<GitRemote> {
    git_add_remote(dir, name, url)
}

#[command]
pub async fn rm_remote(dir: &Path, name: &str) -> Result<()> {
    git_rm_remote(dir, name)
}
