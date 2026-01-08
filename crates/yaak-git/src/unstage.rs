use crate::repository::open_repo;
use log::info;
use std::path::Path;

pub fn git_unstage(dir: &Path, rela_path: &Path) -> crate::error::Result<()> {
    let repo = open_repo(dir)?;

    let head = match repo.head() {
        Ok(h) => h,
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => {
            info!("Unstaging file in empty branch {rela_path:?} to {dir:?}");
            // Repo has no commits, so "unstage" means remove from index
            let mut index = repo.index()?;
            index.remove_path(rela_path)?;
            index.write()?;
            return Ok(());
        }
        Err(e) => return Err(e.into()),
    };

    // If repo has commits, update the index entry back to HEAD
    info!("Unstaging file {rela_path:?} to {dir:?}");
    let commit = head.peel_to_commit()?;
    repo.reset_default(Some(commit.as_object()), &[rela_path])?;

    Ok(())
}
