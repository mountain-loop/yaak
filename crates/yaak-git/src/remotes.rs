use crate::error::Result;
use crate::repository::open_repo;
use log::warn;
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "gen_git.ts")]
pub struct GitRemote {
    name: String,
    url: Option<String>,
}

pub fn git_remotes(dir: &Path) -> Result<Vec<GitRemote>> {
    let repo = open_repo(dir)?;
    let mut remotes = Vec::new();

    for remote in repo.remotes()?.into_iter() {
        let name = match remote {
            None => continue,
            Some(name) => name,
        };
        let r = match repo.find_remote(name) {
            Ok(r) => r,
            Err(e) => {
                warn!("Failed to get remote {name}: {e:?}");
                continue;
            }
        };
        remotes.push(GitRemote { name: name.to_string(), url: r.url().map(|u| u.to_string()) });
    }

    Ok(remotes)
}

pub fn git_add_remote(dir: &Path, name: &str, url: &str) -> Result<GitRemote> {
    let repo = open_repo(dir)?;
    repo.remote(name, url)?;
    Ok(GitRemote { name: name.to_string(), url: Some(url.to_string()) })
}

pub fn git_rm_remote(dir: &Path, name: &str) -> Result<()> {
    let repo = open_repo(dir)?;
    repo.remote_delete(name)?;
    Ok(())
}
