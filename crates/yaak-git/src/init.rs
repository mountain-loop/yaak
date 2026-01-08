use crate::error::Result;
use crate::repository::open_repo;
use log::info;
use std::path::Path;

pub fn git_init(dir: &Path) -> Result<()> {
    git2::Repository::init(dir)?;
    let repo = open_repo(dir)?;
    // Default to main instead of master, to align with
    // the official Git and GitHub behavior
    repo.set_head("refs/heads/main")?;
    info!("Initialized {dir:?}");
    Ok(())
}
