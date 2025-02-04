use crate::error::Result;
use crate::git::{
    git_add, git_commit, git_init, git_log, git_status, git_unstage, GitCommit, GitStatusSummary,
};
use std::path::{Path, PathBuf};
use tauri::command;

#[command]
pub fn checkout() -> Result<()> {
    todo!("checkout")
}

#[command]
pub fn status(dir: &Path) -> Result<GitStatusSummary> {
    git_status(dir)
}

#[command]
pub fn log(dir: &Path) -> Result<Vec<GitCommit>> {
    git_log(dir)
}

#[command]
pub fn initialize(dir: &Path) -> Result<()> {
    git_init(dir)
}

#[command]
pub fn commit(dir: &Path, message: &str) -> Result<()> {
    git_commit(dir, message)
}

#[command]
pub fn add(dir: &Path, rela_paths: Vec<PathBuf>) -> Result<()> {
    for path in rela_paths {
        git_add(dir, &path)?;
    }
    Ok(())
}

#[command]
pub fn unstage(dir: &Path, rela_paths: Vec<PathBuf>) -> Result<()> {
    for path in rela_paths {
        git_unstage(dir, &path)?;
    }
    Ok(())
}
