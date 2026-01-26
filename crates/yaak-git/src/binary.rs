use crate::error::Error::GitNotFound;
use crate::error::Result;
use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;
use yaak_common::command::new_xplatform_command;

/// Create a git command that runs in the specified directory
pub(crate) async fn new_binary_command(dir: &Path) -> Result<Command> {
    let mut cmd = new_binary_command_global().await?;
    cmd.arg("-C").arg(dir);
    Ok(cmd)
}

/// Create a git command without a specific directory (for global operations)
pub(crate) async fn new_binary_command_global() -> Result<Command> {
    // 1. Probe that `git` exists and is runnable
    let mut probe = new_xplatform_command("git");
    probe.arg("--version").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());

    let status = probe.status().await.map_err(|_| GitNotFound)?;

    if !status.success() {
        return Err(GitNotFound);
    }

    // 2. Build the reusable git command
    let cmd = new_xplatform_command("git");
    Ok(cmd)
}
