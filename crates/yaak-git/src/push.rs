use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use crate::error::Result;
use crate::repository::open_repo;
use crate::util::{get_current_branch_name, get_default_remote_for_push_in_repo};
use log::info;
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_git.ts")]
pub enum PushResult {
    Success { message: String },
    UpToDate,
    NeedsCredentials { url: String, error: Option<String> },
}

pub async fn git_push(dir: &Path) -> Result<PushResult> {
    // Extract all git2 data before any await points (git2 types are not Send)
    let (branch_name, remote_name, remote_url) = {
        let repo = open_repo(dir)?;
        let branch_name = get_current_branch_name(&repo)?;
        let remote = get_default_remote_for_push_in_repo(&repo)?;
        let remote_name =
            remote.name().ok_or(GenericError("Failed to get remote name".to_string()))?.to_string();
        let remote_url =
            remote.url().ok_or(GenericError("Failed to get remote url".to_string()))?.to_string();
        (branch_name, remote_name, remote_url)
    };

    let out = new_binary_command(dir)
        .await?
        .args(["push", &remote_name, &branch_name])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to run git push: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = stdout + stderr;
    let combined_lower = combined.to_lowercase();

    info!("Pushed to repo status={} {combined}", out.status);

    // Helper to check if this is a credentials error
    let is_credentials_error = || {
        combined_lower.contains("could not read")
            || combined_lower.contains("unable to access")
            || combined_lower.contains("authentication failed")
    };

    // Check for explicit rejection indicators first (e.g., protected branch rejections)
    // These can occur even if some git servers don't properly set exit codes
    if combined_lower.contains("rejected") || combined_lower.contains("failed to push") {
        if is_credentials_error() {
            return Ok(PushResult::NeedsCredentials {
                url: remote_url.to_string(),
                error: Some(combined.to_string()),
            });
        }
        return Err(GenericError(format!("Failed to push: {combined}")));
    }

    // Check exit status for any other failures
    if !out.status.success() {
        if combined_lower.contains("could not read") {
            return Ok(PushResult::NeedsCredentials { url: remote_url.to_string(), error: None });
        }
        if combined_lower.contains("unable to access")
            || combined_lower.contains("authentication failed")
        {
            return Ok(PushResult::NeedsCredentials {
                url: remote_url.to_string(),
                error: Some(combined.to_string()),
            });
        }
        return Err(GenericError(format!("Failed to push: {combined}")));
    }

    // Success cases (exit code 0 and no rejection indicators)
    if combined_lower.contains("up-to-date") {
        return Ok(PushResult::UpToDate);
    }

    Ok(PushResult::Success { message: format!("Pushed to {}/{}", remote_name, branch_name) })
}
