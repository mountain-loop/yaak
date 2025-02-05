use std::path::Path;
use crate::error::Error::{GitRepoNotFound, GitUnknown};

pub(crate) fn open_repo(dir: &Path) -> crate::error::Result<git2::Repository> {
    match git2::Repository::discover(dir) {
        Ok(r) => Ok(r),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Err(GitRepoNotFound(dir.to_path_buf())),
        Err(e) => Err(GitUnknown(e)),
    }
}

