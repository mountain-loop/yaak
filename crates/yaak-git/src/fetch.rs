use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use crate::error::Result;
use std::path::Path;

pub async fn git_fetch_all(dir: &Path) -> Result<()> {
    let out = new_binary_command(dir)
        .await?
        .args(["fetch", "--all", "--prune", "--tags"])
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to run git pull: {e}")))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = stdout + stderr;

    if !out.status.success() {
        return Err(GenericError(format!("Failed to fetch: {}", combined)));
    }

    Ok(())
}
