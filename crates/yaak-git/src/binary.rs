use crate::error::Error::GitNotFound;
use crate::error::Result;
use std::path::Path;
use tokio::process::Command;
use yaak_common::command::new_checked_command;

/// Create a git command that runs in the specified directory
pub(crate) async fn new_binary_command(dir: &Path) -> Result<Command> {
    let mut cmd = new_binary_command_global().await?;
    cmd.arg("-C").arg(dir);
    Ok(cmd)
}

/// Create a git command without a specific directory (for global operations)
pub(crate) async fn new_binary_command_global() -> Result<Command> {
    new_checked_command("git", "--version").await.map_err(|_| GitNotFound)
}
