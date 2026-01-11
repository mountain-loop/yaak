use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use log::info;
use std::path::Path;

pub async fn git_commit(dir: &Path, message: &str) -> crate::error::Result<()> {
    let out =
        new_binary_command(dir).await?.args(["commit", "--message", message]).output().await?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = stdout + stderr;

    if !out.status.success() {
        return Err(GenericError(format!("Failed to commit: {}", combined)));
    }

    info!("Committed to {dir:?}");

    Ok(())
}
