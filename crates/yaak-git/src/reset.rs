use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use crate::error::Result;
use std::path::Path;

pub async fn git_reset_changes(dir: &Path) -> Result<()> {
    let out = new_binary_command(dir)
        .await?
        .args(["reset", "--hard", "HEAD"])
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to run git reset: {e}")))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(GenericError(format!("Failed to reset: {}", stderr.trim())));
    }

    Ok(())
}
