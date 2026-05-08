use crate::error::Error::{GitRepoNotFound, GitUnknown};
use crate::error::{Error, Result};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct GitRepositoryPaths {
    pub workdir: PathBuf,
    pub gitdir: PathBuf,
}

pub(crate) fn open_repo(dir: &Path) -> crate::error::Result<git2::Repository> {
    match git2::Repository::discover(dir) {
        Ok(r) => Ok(r),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Err(GitRepoNotFound(dir.to_path_buf())),
        Err(e) => Err(GitUnknown(e)),
    }
}

pub fn git_repository_paths(dir: &Path) -> Result<GitRepositoryPaths> {
    let repo = open_repo(dir)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| Error::GenericError("Git repository does not have a worktree".into()))?
        .to_path_buf();
    Ok(GitRepositoryPaths { workdir, gitdir: repo.path().to_path_buf() })
}

pub fn git_path_is_ignored(dir: &Path, rela_path: &Path) -> Result<bool> {
    let repo = open_repo(dir)?;
    Ok(repo.status_should_ignore(rela_path)?)
}
