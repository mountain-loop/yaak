use crate::error::Error::GenericError;
use crate::error::Result;
use crate::merge::do_merge;
use crate::repository::open_repo;
use crate::util::{
    bytes_to_string, get_branch_by_name, get_current_branch, get_default_remote_for_push_in_repo,
};
use git2::build::CheckoutBuilder;
use git2::{BranchType, Repository};
use log::info;
use std::path::Path;

pub(crate) fn branch_set_upstream_after_push(repo: &Repository, branch_name: &str) -> Result<()> {
    let mut branch = repo.find_branch(branch_name, BranchType::Local)?;

    if branch.upstream().is_err() {
        let remote = get_default_remote_for_push_in_repo(repo)?;
        let upstream_name = format!("{remote}/{branch_name}");
        branch.set_upstream(Some(upstream_name.as_str()))?;
    }

    Ok(())
}

pub(crate) fn git_checkout_branch(dir: &Path, branch: &str, force: bool) -> Result<()> {
    let repo = open_repo(dir)?;
    let branch = get_branch_by_name(&repo, branch)?;
    let branch_ref = branch.into_reference();
    let branch_tree = branch_ref.peel_to_tree()?;

    let mut options = CheckoutBuilder::default();
    if force {
        options.force();
    }

    repo.checkout_tree(branch_tree.as_object(), Some(&mut options))?;
    repo.set_head(branch_ref.name().unwrap())?;

    Ok(())
}

pub(crate) fn git_create_branch(dir: &Path, name: &str) -> Result<()> {
    let repo = open_repo(dir)?;
    let head = match repo.head() {
        Ok(h) => h,
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => {
            let msg = "Cannot create branch when there are no commits";
            return Err(GenericError(msg.into()));
        }
        Err(e) => return Err(e.into()),
    };
    let head = head.peel_to_commit()?;

    repo.branch(name, &head, false)?;

    Ok(())
}

pub(crate) fn git_delete_branch(dir: &Path, name: &str) -> Result<()> {
    let repo = open_repo(dir)?;
    let mut branch = get_branch_by_name(&repo, name)?;

    if branch.is_head() {
        info!("Deleting head branch");
        let branches = repo.branches(Some(BranchType::Local))?;
        let other_branch = branches.into_iter().filter_map(|b| b.ok()).find(|b| !b.0.is_head());
        let other_branch = match other_branch {
            None => return Err(GenericError("Cannot delete only branch".into())),
            Some(b) => bytes_to_string(b.0.name_bytes()?)?,
        };

        git_checkout_branch(dir, &other_branch, true)?;
    }

    branch.delete()?;

    Ok(())
}

pub(crate) fn git_merge_branch(dir: &Path, name: &str, _force: bool) -> Result<()> {
    let repo = open_repo(dir)?;
    let local_branch = get_current_branch(&repo)?.unwrap();

    let commit_to_merge = get_branch_by_name(&repo, name)?.into_reference();
    let commit_to_merge = repo.reference_to_annotated_commit(&commit_to_merge)?;

    do_merge(&repo, &local_branch, &commit_to_merge)?;

    Ok(())
}
