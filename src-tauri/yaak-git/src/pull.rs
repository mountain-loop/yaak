use crate::callbacks::default_callbacks;
use crate::error::Error::NoActiveBranch;
use crate::error::Result;
use crate::merge::do_merge;
use crate::repository::open_repo;
use crate::util::{bytes_to_string, get_current_branch};
use git2::{FetchOptions, ProxyOptions};
use log::debug;
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub(crate) struct PullResult {
    received_bytes: usize,
    received_objects: usize,
}

pub(crate) fn git_pull(dir: &Path) -> Result<PullResult> {
    let repo = open_repo(dir)?;

    let branch = get_current_branch(&repo)?.ok_or(NoActiveBranch)?;
    let branch_ref = branch.get();
    let branch_ref = bytes_to_string(branch_ref.name_bytes())?;

    let remote_name = repo.branch_upstream_remote(&branch_ref)?;
    let remote_name = bytes_to_string(&remote_name)?;
    debug!("Pulling from {remote_name}");

    let mut remote = repo.find_remote(&remote_name)?;

    let mut options = FetchOptions::new();
    let callbacks = default_callbacks();
    options.remote_callbacks(callbacks);

    let mut proxy = ProxyOptions::new();
    proxy.auto();
    options.proxy_options(proxy);

    remote.fetch(&[&branch_ref], Some(&mut options), None)?;

    let stats = remote.stats();

    let fetch_head = repo.find_reference("FETCH_HEAD")?;
    let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)?;
    do_merge(&repo, &branch, &fetch_commit)?;

    Ok(PullResult {
        received_bytes: stats.received_bytes(),
        received_objects: stats.received_objects(),
    })
}
