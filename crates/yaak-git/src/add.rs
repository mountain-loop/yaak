use crate::error::Result;
use crate::repository::open_repo;
use git2::IndexAddOption;
use log::info;
use std::path::Path;

pub fn git_add(dir: &Path, rela_path: &Path) -> Result<()> {
    let repo = open_repo(dir)?;
    let mut index = repo.index()?;

    info!("Staging file {rela_path:?} to {dir:?}");
    index.add_all(&[rela_path], IndexAddOption::DEFAULT, None)?;
    index.write()?;

    Ok(())
}
