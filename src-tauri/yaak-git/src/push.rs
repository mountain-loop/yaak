use crate::binary::new_binary_command;
use crate::branch::branch_set_upstream_after_push;
use crate::callbacks::default_callbacks;
use crate::error::Error::GenericError;
use crate::error::Result;
use crate::repository::open_repo;
use git2::{ProxyOptions, PushOptions};
use log::debug;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_git.ts")]
pub(crate) enum PushType {
    Branch,
    Tag,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_git.ts")]
pub(crate) enum PushResult {
    Success { output: String },
    NothingToPush,
    NeedsCredentials { url: String, error: Option<String> },
}

pub(crate) fn git_push(dir: &Path) -> Result<PushResult> {
    let repo = open_repo(dir)?;
    let head = repo.head()?;
    let branch = head.shorthand().unwrap();
    let remote = repo.find_remote("origin")?;
    let remote_name = remote.name().ok_or(GenericError("Failed to get remote name".to_string()))?;
    let remote_url = remote.url().ok_or(GenericError("Failed to get remote url".to_string()))?;

    let out = new_binary_command(dir)
        .arg("push")
        .arg(remote_name)
        .arg(branch)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| GenericError(format!("failed to run git push: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = stdout + stderr;

    debug!("Pushed to repo {} {combined}", out.status);

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
        return Ok(PushResult::NothingToPush);
    }

    if !out.status.success() {
        return Err(GenericError(format!("Failed to push {combined}")));
    }

    Ok(PushResult::Success {
        output: combined.to_string(),
    })
}

#[allow(unused)]
pub(crate) fn git_push_old(dir: &Path) -> Result<PushResult> {
    let repo = open_repo(dir)?;
    let head = repo.head()?;
    let branch = head.shorthand().unwrap();
    let mut remote = repo.find_remote("origin")?;

    let mut options = PushOptions::new();
    options.packbuilder_parallelism(0);

    let push_result = Mutex::new(PushResult::NothingToPush);

    let mut callbacks = default_callbacks();
    callbacks.push_transfer_progress(|_current, _total, _bytes| {
        let mut push_result = push_result.lock().unwrap();
        *push_result = PushResult::Success {
            output: "Pushed".to_string(),
        };
    });

    options.remote_callbacks(default_callbacks());

    let mut proxy = ProxyOptions::new();
    proxy.auto();
    options.proxy_options(proxy);

    // Push the current branch
    let force = false;
    let delete = false;
    let branch_modifier = match (force, delete) {
        (true, true) => "+:",
        (false, true) => ":",
        (true, false) => "+",
        (false, false) => "",
    };

    let ref_type = PushType::Branch;

    let ref_type = match ref_type {
        PushType::Branch => "heads",
        PushType::Tag => "tags",
    };

    let refspec = format!("{branch_modifier}refs/{ref_type}/{branch}");
    remote.push(&[refspec], Some(&mut options))?;

    branch_set_upstream_after_push(&repo, branch)?;

    let push_result = push_result.lock().unwrap();
    Ok(push_result.clone())
}
