use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use crate::error::Result;
use log::info;
use std::path::Path;

pub async fn git_clone(url: &str, dir: &Path) -> Result<()> {
    let parent = dir.parent().ok_or_else(|| GenericError("Invalid clone directory".to_string()))?;
    let mut cmd = new_binary_command(parent).await?;
    cmd.args(["clone", url]).arg(dir).env("GIT_TERMINAL_PROMPT", "0");

    let out =
        cmd.output().await.map_err(|e| GenericError(format!("failed to run git clone: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{}{}", stdout, stderr);

    info!("Cloned status={}: {combined}", out.status);

    if !out.status.success() {
        return Err(GenericError(format!("Failed to clone: {}", combined.trim())));
    }

    Ok(())
}
