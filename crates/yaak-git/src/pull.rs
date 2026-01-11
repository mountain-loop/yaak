use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use crate::error::Result;
use crate::repository::open_repo;
use crate::util::{get_current_branch_name, get_default_remote_in_repo};
use log::info;
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_git.ts")]
pub enum PullResult {
    Success { message: String },
    UpToDate,
    NeedsCredentials { url: String, error: Option<String> },
}

pub async fn git_pull(dir: &Path) -> Result<PullResult> {
    // Extract all git2 data before any await points (git2 types are not Send)
    let (branch_name, remote_name, remote_url) = {
        let repo = open_repo(dir)?;
        let branch_name = get_current_branch_name(&repo)?;
        let remote = get_default_remote_in_repo(&repo)?;
        let remote_name =
            remote.name().ok_or(GenericError("Failed to get remote name".to_string()))?.to_string();
        let remote_url =
            remote.url().ok_or(GenericError("Failed to get remote url".to_string()))?.to_string();
        (branch_name, remote_name, remote_url)
    };

    let out = new_binary_command(dir)
        .await?
        .args(["pull", &remote_name, &branch_name])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to run git pull: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = stdout + stderr;

    info!("Pulled status={} {combined}", out.status);

    if combined.to_lowercase().contains("could not read") {
        return Ok(PullResult::NeedsCredentials { url: remote_url.to_string(), error: None });
    }

    if combined.to_lowercase().contains("unable to access") {
        return Ok(PullResult::NeedsCredentials {
            url: remote_url.to_string(),
            error: Some(combined.to_string()),
        });
    }

    if !out.status.success() {
        return Err(GenericError(format!("Failed to pull {combined}")));
    }

    if combined.to_lowercase().contains("up to date") {
        return Ok(PullResult::UpToDate);
    }

    Ok(PullResult::Success { message: format!("Pulled from {}/{}", remote_name, branch_name) })
}

// pub(crate) fn git_pull_old(dir: &Path) -> Result<PullResult> {
//     let repo = open_repo(dir)?;
//
//     let branch = get_current_branch(&repo)?.ok_or(NoActiveBranch)?;
//     let branch_ref = branch.get();
//     let branch_ref = bytes_to_string(branch_ref.name_bytes())?;
//
//     let remote_name = repo.branch_upstream_remote(&branch_ref)?;
//     let remote_name = bytes_to_string(&remote_name)?;
//     debug!("Pulling from {remote_name}");
//
//     let mut remote = repo.find_remote(&remote_name)?;
//
//     let mut options = FetchOptions::new();
//     let callbacks = default_callbacks();
//     options.remote_callbacks(callbacks);
//
//     let mut proxy = ProxyOptions::new();
//     proxy.auto();
//     options.proxy_options(proxy);
//
//     remote.fetch(&[&branch_ref], Some(&mut options), None)?;
//
//     let stats = remote.stats();
//
//     let fetch_head = repo.find_reference("FETCH_HEAD")?;
//     let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)?;
//     do_merge(&repo, &branch, &fetch_commit)?;
//
//     Ok(PullResult::Success {
//         message: "Hello".to_string(),
//         // received_bytes: stats.received_bytes(),
//         // received_objects: stats.received_objects(),
//     })
// }
