use git2::{BranchType, Repository};
use crate::util::get_default_remote_for_push_in_repo;

pub(crate) fn branch_set_upstream_after_push(repo: &Repository, branch_name: &str) -> crate::error::Result<()> {
    let mut branch = repo.find_branch(branch_name, BranchType::Local)?;

    if branch.upstream().is_err() {
        let remote = get_default_remote_for_push_in_repo(repo)?;
        let upstream_name = format!("{remote}/{branch_name}");
        branch.set_upstream(Some(upstream_name.as_str()))?;
    }

    Ok(())
}
