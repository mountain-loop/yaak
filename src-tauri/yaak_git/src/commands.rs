use crate::errors::Result;
use crate::git::{git_status, GitStatusEntry};
use std::path::PathBuf;
use tauri::command;

#[command]
pub async fn checkout() -> Result<()> {
    todo!("checkout")
}

#[command]
pub async fn status(dir: &str) -> Result<Vec<GitStatusEntry>> {
    let path_dir = PathBuf::from(dir);
    git_status(&path_dir)
}

#[command]
pub async fn commit() -> Result<()> {
    todo!("commit")
}
