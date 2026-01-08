use crate::error::Error::GenericError;
use crate::error::Result;
use crate::merge::do_merge;
use crate::repository::open_repo;
use crate::util::{bytes_to_string, get_branch_by_name, get_current_branch};
use git2::BranchType;
use git2::build::CheckoutBuilder;
use log::info;
use std::path::Path;

pub fn git_checkout_branch(dir: &Path, branch_name: &str, force: bool) -> Result<String> {
    if branch_name.starts_with("origin/") {
        return git_checkout_remote_branch(dir, branch_name, force);
    }

    let repo = open_repo(dir)?;
    let branch = get_branch_by_name(&repo, branch_name)?;
    let branch_ref = branch.into_reference();
    let branch_tree = branch_ref.peel_to_tree()?;

    let mut options = CheckoutBuilder::default();
    if force {
        options.force();
    }

    repo.checkout_tree(branch_tree.as_object(), Some(&mut options))?;
    repo.set_head(branch_ref.name().unwrap())?;

    Ok(branch_name.to_string())
}

pub(crate) fn git_checkout_remote_branch(
    dir: &Path,
    branch_name: &str,
    force: bool,
) -> Result<String> {
    let branch_name = branch_name.trim_start_matches("origin/");
    let repo = open_repo(dir)?;

    let refname = format!("refs/remotes/origin/{}", branch_name);
    let remote_ref = repo.find_reference(&refname)?;
    let commit = remote_ref.peel_to_commit()?;

    let mut new_branch = repo.branch(branch_name, &commit, false)?;
    let upstream_name = format!("origin/{}", branch_name);
    new_branch.set_upstream(Some(&upstream_name))?;

    git_checkout_branch(dir, branch_name, force)
}

pub fn git_create_branch(dir: &Path, name: &str) -> Result<()> {
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

pub fn git_delete_branch(dir: &Path, name: &str) -> Result<()> {
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

pub fn git_merge_branch(dir: &Path, name: &str, _force: bool) -> Result<()> {
    let repo = open_repo(dir)?;
    let local_branch = get_current_branch(&repo)?.unwrap();

    let commit_to_merge = get_branch_by_name(&repo, name)?.into_reference();
    let commit_to_merge = repo.reference_to_annotated_commit(&commit_to_merge)?;

    do_merge(&repo, &local_branch, &commit_to_merge)?;

    Ok(())
}
