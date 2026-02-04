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
    Diverged { remote: String, branch: String },
    UncommittedChanges,
}

fn has_uncommitted_changes(dir: &Path) -> Result<bool> {
    let repo = open_repo(dir)?;
    let mut opts = git2::StatusOptions::new();
    opts.include_ignored(false).include_untracked(false);
    let statuses = repo.statuses(Some(&mut opts))?;
    Ok(statuses.iter().any(|e| e.status() != git2::Status::CURRENT))
}

pub async fn git_pull(dir: &Path) -> Result<PullResult> {
    if has_uncommitted_changes(dir)? {
        return Ok(PullResult::UncommittedChanges);
    }

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
        let combined_lower = combined.to_lowercase();
        if combined_lower.contains("cannot fast-forward")
            || combined_lower.contains("not possible to fast-forward")
            || combined_lower.contains("diverged")
        {
            return Ok(PullResult::Diverged { remote: remote_name, branch: branch_name });
        }
        return Err(GenericError(format!("Failed to pull {combined}")));
    }

    if combined.to_lowercase().contains("up to date") {
        return Ok(PullResult::UpToDate);
    }

    Ok(PullResult::Success { message: format!("Pulled from {}/{}", remote_name, branch_name) })
}

pub async fn git_pull_force_reset(dir: &Path, remote: &str, branch: &str) -> Result<PullResult> {
    // Step 1: fetch the remote
    let fetch_out = new_binary_command(dir)
        .await?
        .args(["fetch", remote])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to run git fetch: {e}")))?;

    if !fetch_out.status.success() {
        let stderr = String::from_utf8_lossy(&fetch_out.stderr);
        return Err(GenericError(format!("Failed to fetch: {stderr}")));
    }

    // Step 2: reset --hard to remote/branch
    let ref_name = format!("{}/{}", remote, branch);
    let reset_out = new_binary_command(dir)
        .await?
        .args(["reset", "--hard", &ref_name])
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to run git reset: {e}")))?;

    if !reset_out.status.success() {
        let stderr = String::from_utf8_lossy(&reset_out.stderr);
        return Err(GenericError(format!("Failed to reset: {}", stderr.trim())));
    }

    Ok(PullResult::Success { message: format!("Reset to {}/{}", remote, branch) })
}

pub async fn git_pull_merge(dir: &Path, remote: &str, branch: &str) -> Result<PullResult> {
    let out = new_binary_command(dir)
        .await?
        .args(["pull", "--no-rebase", remote, branch])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to run git pull --no-rebase: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{}{}", stdout, stderr);

    info!("Pull merge status={} {combined}", out.status);

    if !out.status.success() {
        if combined.to_lowercase().contains("conflict") {
            return Err(GenericError(
                "Merge conflicts detected. Please resolve them manually.".to_string(),
            ));
        }
        return Err(GenericError(format!("Failed to merge pull: {}", combined.trim())));
    }

    Ok(PullResult::Success { message: format!("Merged from {}/{}", remote, branch) })
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
