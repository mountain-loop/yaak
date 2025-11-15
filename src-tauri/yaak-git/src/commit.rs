use crate::repository::open_repo;
use chrono::{DateTime, Utc};
use log::info;
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub(crate) struct GitCommit {
    pub author: GitAuthor,
    pub when: DateTime<Utc>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub(crate) struct GitAuthor {
    pub name: Option<String>,
    pub email: Option<String>,
}

pub(crate) fn git_commit(dir: &Path, message: &str) -> crate::error::Result<()> {
    let repo = open_repo(dir)?;

    // Clear the in-memory index, add the paths, and write the tree for committing
    let tree_oid = repo.index()?.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;

    // Make the signature
    let config = repo.config()?.snapshot()?;
    let name = config.get_str("user.name").unwrap_or("Unknown");
    let email = config.get_str("user.email")?;
    let sig = git2::Signature::now(name, email)?;

    // Get the current HEAD commit (if it exists)
    let parent_commit = match repo.head() {
        Ok(head) => Some(head.peel_to_commit()?),
        Err(_) => None, // No parent if no HEAD exists (initial commit)
    };

    let parents = parent_commit.as_ref().map(|p| vec![p]).unwrap_or_default();
    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, parents.as_slice())?;

    info!("Committed to {dir:?}");

    Ok(())
}
