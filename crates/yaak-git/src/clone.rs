use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use crate::error::Result;
use log::info;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_git.ts")]
pub enum CloneResult {
    Success,
    Cancelled,
    NeedsCredentials { url: String, error: Option<String> },
}

pub async fn git_clone(url: &str, dir: &Path) -> Result<CloneResult> {
    let parent = dir.parent().ok_or_else(|| GenericError("Invalid clone directory".to_string()))?;
    fs::create_dir_all(parent)
        .map_err(|e| GenericError(format!("Failed to create directory: {e}")))?;
    let mut cmd = new_binary_command(parent).await?;
    cmd.args(["clone", url]).arg(dir).env("GIT_TERMINAL_PROMPT", "0");

    let out =
        cmd.output().await.map_err(|e| GenericError(format!("failed to run git clone: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{}{}", stdout, stderr);
    let combined_lower = combined.to_lowercase();

    info!("Cloned status={}: {combined}", out.status);

    if !out.status.success() {
        // Check for credentials error
        if combined_lower.contains("could not read") {
            return Ok(CloneResult::NeedsCredentials { url: url.to_string(), error: None });
        }
        if combined_lower.contains("unable to access")
            || combined_lower.contains("authentication failed")
        {
            return Ok(CloneResult::NeedsCredentials {
                url: url.to_string(),
                error: Some(combined.to_string()),
            });
        }
        return Err(GenericError(format!("Failed to clone: {}", combined.trim())));
    }

    Ok(CloneResult::Success)
}
