use crate::callbacks::callbacks;
use crate::error::Error::{GenericError, NoActiveBranch};
use crate::error::Result;
use crate::repository::open_repo;
use crate::util::{bytes_to_string, get_current_branch};
use git2::{Branch, FetchOptions, ProxyOptions, Repository};
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
    options.remote_callbacks(callbacks());

    let mut proxy = ProxyOptions::new();
    proxy.auto();
    options.proxy_options(proxy);

    remote.fetch(&[&branch_ref], Some(&mut options), None)?;

    branch_merge_upstream_fastforward(&repo, &branch)?;

    let stats = remote.stats();

    Ok(PullResult {
        received_bytes: stats.received_bytes(),
        received_objects: stats.received_objects(),
    })
}

pub fn branch_merge_upstream_fastforward(repo: &Repository, branch: &Branch) -> Result<()> {
    let upstream = branch.upstream()?;

    let upstream_commit = upstream.into_reference().peel_to_commit()?;
    let annotated = repo.find_annotated_commit(upstream_commit.id())?;
    let (analysis, pref) = repo.merge_analysis(&[&annotated])?;

    if !analysis.is_fast_forward() {
        return Err(GenericError("fast forward merge not possible".into()));
    }

    if pref.is_no_fast_forward() {
        return Err(GenericError("fast forward not wanted".into()));
    }

    //TODO: support merge on unborn
    if analysis.is_unborn() {
        return Err(GenericError("head is unborn".into()));
    }

    repo.checkout_tree(upstream_commit.as_object(), None)?;
    repo.head()?.set_target(annotated.id(), "")?;

    Ok(())
}
