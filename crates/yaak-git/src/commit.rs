use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use log::info;
use std::path::Path;

/// Commit the given repo-relative paths (their current worktree content).
/// Scoping the commit to explicit paths means files staged outside of Yaak
/// (e.g. in a containing monorepo) are never swept into a Yaak commit — they
/// stay staged for the user's own next commit. An empty `paths` commits the
/// whole index (old behavior).
pub async fn git_commit(dir: &Path, message: &str, paths: &[String]) -> crate::error::Result<()> {
    let mut cmd = new_binary_command(dir).await?;
    cmd.args(["commit", "--message", message]);
    if !paths.is_empty() {
        cmd.arg("--");
        cmd.args(paths);
    }
    let out = cmd.output().await?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = stdout + stderr;

    if !out.status.success() {
        return Err(GenericError(format!("Failed to commit: {}", combined)));
    }

    info!("Committed to {dir:?}");

    Ok(())
}
