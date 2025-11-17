use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use crate::error::Result;
use crate::repository::open_repo;
use crate::util::get_current_branch_name;
use log::info;
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_git.ts")]
pub(crate) enum PushResult {
    Success { message: String },
    UpToDate,
    NeedsCredentials { url: String, error: Option<String> },
}

pub(crate) fn git_push(dir: &Path) -> Result<PushResult> {
    let repo = open_repo(dir)?;
    let branch_name = get_current_branch_name(&repo)?;
    let remote = repo.find_remote("origin")?;
    let remote_name = remote.name().ok_or(GenericError("Failed to get remote name".to_string()))?;
    let remote_url = remote.url().ok_or(GenericError("Failed to get remote url".to_string()))?;

    let out = new_binary_command(dir)
        .arg("push")
        .arg(&remote_name)
        .arg(&branch_name)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| GenericError(format!("failed to run git push: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = stdout + stderr;

    info!("Pushed to repo status={} {combined}", out.status);

    if combined.to_lowercase().contains("could not read") {
        return Ok(PushResult::NeedsCredentials {
            url: remote_url.to_string(),
            error: None,
        });
    }

    if combined.to_lowercase().contains("unable to access") {
        return Ok(PushResult::NeedsCredentials {
            url: remote_url.to_string(),
            error: Some(combined.to_string()),
        });
    }

    if combined.to_lowercase().contains("up-to-date") {
        return Ok(PushResult::UpToDate);
    }

    if !out.status.success() {
        return Err(GenericError(format!("Failed to push {combined}")));
    }

    Ok(PushResult::Success {
        message: format!("Pushed to {}/{}", remote_name, branch_name),
    })
}
