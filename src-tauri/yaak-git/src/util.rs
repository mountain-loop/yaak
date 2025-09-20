use crate::error::Error::{GenericError, NoDefaultRemoteFound};
use crate::error::Result;
use git2::{Branch, BranchType, Repository};
use std::env;
use std::path::{Path, PathBuf};

const DEFAULT_REMOTE_NAME: &str = "origin";

pub(crate) fn find_ssh_key() -> Option<PathBuf> {
    let home_dir = env::var("HOME").ok()?;
    let key_paths = [
        format!("{}/.ssh/id_ed25519", home_dir),
        format!("{}/.ssh/id_rsa", home_dir),
        format!("{}/.ssh/id_ecdsa", home_dir),
        format!("{}/.ssh/id_dsa", home_dir),
    ];

    for key_path in key_paths.iter() {
        let path = Path::new(key_path);
        if path.exists() {
            return Some(path.to_path_buf());
        }
    }
    None
}

pub(crate) fn get_current_branch(repo: &Repository) -> Result<Option<Branch<'_>>> {
    for b in repo.branches(None)? {
        let branch = b?.0;
        if branch.is_head() {
            return Ok(Some(branch));
        }
    }
    Ok(None)
}

pub(crate) fn local_branch_names(repo: &Repository) -> Result<Vec<String>> {
    let mut branches = Vec::new();
    for branch in repo.branches(Some(BranchType::Local))? {
        let branch = branch?.0;
        let name = branch.name_bytes()?;
        let name = bytes_to_string(name)?;
        branches.push(name);
    }
    Ok(branches)
}

pub(crate) fn remote_branch_names(repo: &Repository) -> Result<Vec<String>> {
    let mut branches = Vec::new();
    for branch in repo.branches(Some(BranchType::Remote))? {
        let branch = branch?.0;
        let name = branch.name_bytes()?;
        let name = bytes_to_string(name)?;
        branches.push(name);
    }
    Ok(branches)
}

pub(crate) fn get_branch_by_name<'s>(repo: &'s Repository, name: &str) -> Result<Branch<'s>> {
    Ok(repo.find_branch(name, BranchType::Local)?)
}

pub(crate) fn bytes_to_string(bytes: &[u8]) -> Result<String> {
    Ok(String::from_utf8(bytes.to_vec())?)
}

pub(crate) fn get_default_remote_for_push_in_repo(repo: &Repository) -> Result<String> {
    let config = repo.config()?;

    let branch = get_current_branch(repo)?;

    if let Some(branch) = branch {
        let remote_name = bytes_to_string(branch.name_bytes()?)?;

        let entry_name = format!("branch.{}.pushRemote", &remote_name);

        if let Ok(entry) = config.get_entry(&entry_name) {
            return bytes_to_string(entry.value_bytes());
        }

        if let Ok(entry) = config.get_entry("remote.pushDefault") {
            return bytes_to_string(entry.value_bytes());
        }

        let entry_name = format!("branch.{}.remote", &remote_name);

        if let Ok(entry) = config.get_entry(&entry_name) {
            return bytes_to_string(entry.value_bytes());
        }
    }

    get_default_remote_in_repo(repo)
}

pub(crate) fn get_default_remote_in_repo(repo: &Repository) -> Result<String> {
    let remotes = repo.remotes()?;

    // if `origin` exists return that
    let found_origin = remotes.iter().any(|r| r.is_some_and(|r| r == DEFAULT_REMOTE_NAME));
    if found_origin {
        return Ok(DEFAULT_REMOTE_NAME.into());
    }

    // if only one remote exists, pick that
    if remotes.len() == 1 {
        let first_remote = remotes
            .iter()
            .next()
            .flatten()
            .map(String::from)
            .ok_or_else(|| GenericError("no remote found".into()))?;

        return Ok(first_remote);
    }

    // inconclusive
    Err(NoDefaultRemoteFound)
}
