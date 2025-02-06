use crate::branch::branch_set_upstream_after_push;
use crate::callbacks::default_callbacks;
use crate::error::Result;
use crate::repository::open_repo;
use git2::{ProxyOptions, PushOptions};
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
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_git.ts")]
pub(crate) enum PushResult {
    Success,
    NothingToPush,
}

pub(crate) fn git_push(dir: &Path) -> Result<PushResult> {
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
        *push_result = PushResult::Success;
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
