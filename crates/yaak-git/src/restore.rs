use crate::error::Result;
use crate::repository::open_repo;
use log::info;
use std::fs;
use std::path::{Component, Path};

pub fn git_restore(dir: &Path, rela_path: &Path) -> Result<()> {
    let repo = open_repo(dir)?;
    validate_relative_path(rela_path)?;

    let status = repo.status_file(rela_path).ok();
    let is_untracked = status
        .is_some_and(|s| s.contains(git2::Status::WT_NEW) || s.contains(git2::Status::INDEX_NEW));

    info!("Restoring file {rela_path:?} in {dir:?}");
    if is_untracked {
        let mut index = repo.index()?;
        let _ = index.remove_path(rela_path);
        index.write()?;

        let path = repo.workdir().unwrap_or(dir).join(rela_path);
        if path.is_dir() {
            fs::remove_dir_all(path)?;
        } else if path.exists() {
            fs::remove_file(path)?;
        }
        return Ok(());
    }

    let head = repo.head()?;
    let commit = head.peel_to_commit()?;
    repo.reset_default(Some(commit.as_object()), &[rela_path])?;

    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force().path(rela_path);
    repo.checkout_head(Some(&mut checkout))?;

    Ok(())
}

fn validate_relative_path(path: &Path) -> Result<()> {
    let is_safe = !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path.components().all(|c| matches!(c, Component::Normal(_)));
    if is_safe {
        Ok(())
    } else {
        Err(crate::error::Error::GenericError(format!("Invalid restore path {}", path.display())))
    }
}
