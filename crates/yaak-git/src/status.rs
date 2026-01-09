use crate::repository::open_repo;
use crate::util::{local_branch_names, remote_branch_names};
use log::warn;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use ts_rs::TS;
use yaak_sync::models::SyncModel;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub struct GitStatusSummary {
    pub path: String,
    pub head_ref: Option<String>,
    pub head_ref_shorthand: Option<String>,
    pub entries: Vec<GitStatusEntry>,
    pub origins: Vec<String>,
    pub local_branches: Vec<String>,
    pub remote_branches: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub struct GitStatusEntry {
    pub rela_path: String,
    pub status: GitStatus,
    pub staged: bool,
    pub prev: Option<SyncModel>,
    pub next: Option<SyncModel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_git.ts")]
pub enum GitStatus {
    Untracked,
    Conflict,
    Current,
    Modified,
    Removed,
    Renamed,
    TypeChange,
}

pub fn git_status(dir: &Path) -> crate::error::Result<GitStatusSummary> {
    let repo = open_repo(dir)?;
    let (head_tree, head_ref, head_ref_shorthand) = match repo.head() {
        Ok(head) => {
            let tree = head.peel_to_tree().ok();
            let head_ref_shorthand = head.shorthand().map(|s| s.to_string());
            let head_ref = head.name().map(|s| s.to_string());

            (tree, head_ref, head_ref_shorthand)
        }
        Err(_) => {
            // For "unborn" repos, reading from HEAD is the only way to get the branch name
            // See https://github.com/starship/starship/pull/1336
            let head_path = repo.path().join("HEAD");
            let head_ref = fs::read_to_string(&head_path)
                .ok()
                .unwrap_or_default()
                .lines()
                .next()
                .map(|s| s.trim_start_matches("ref:").trim().to_string());
            let head_ref_shorthand =
                head_ref.clone().map(|r| r.split('/').last().unwrap_or("unknown").to_string());
            (None, head_ref, head_ref_shorthand)
        }
    };

    let mut opts = git2::StatusOptions::new();
    opts.include_ignored(false)
        .include_untracked(true) // Include untracked
        .recurse_untracked_dirs(true) // Show all untracked
        .include_unmodified(true); // Include unchanged

    // TODO: Support renames

    let mut entries: Vec<GitStatusEntry> = Vec::new();
    for entry in repo.statuses(Some(&mut opts))?.into_iter() {
        let rela_path = entry.path().unwrap().to_string();
        let status = entry.status();
        let index_status = match status {
            // Note: order matters here, since we're checking a bitmap!
            s if s.contains(git2::Status::CONFLICTED) => GitStatus::Conflict,
            s if s.contains(git2::Status::INDEX_NEW) => GitStatus::Untracked,
            s if s.contains(git2::Status::INDEX_MODIFIED) => GitStatus::Modified,
            s if s.contains(git2::Status::INDEX_DELETED) => GitStatus::Removed,
            s if s.contains(git2::Status::INDEX_RENAMED) => GitStatus::Renamed,
            s if s.contains(git2::Status::INDEX_TYPECHANGE) => GitStatus::TypeChange,
            s if s.contains(git2::Status::CURRENT) => GitStatus::Current,
            s => {
                warn!("Unknown index status {s:?}");
                continue;
            }
        };

        let worktree_status = match status {
            // Note: order matters here, since we're checking a bitmap!
            s if s.contains(git2::Status::CONFLICTED) => GitStatus::Conflict,
            s if s.contains(git2::Status::WT_NEW) => GitStatus::Untracked,
            s if s.contains(git2::Status::WT_MODIFIED) => GitStatus::Modified,
            s if s.contains(git2::Status::WT_DELETED) => GitStatus::Removed,
            s if s.contains(git2::Status::WT_RENAMED) => GitStatus::Renamed,
            s if s.contains(git2::Status::WT_TYPECHANGE) => GitStatus::TypeChange,
            s if s.contains(git2::Status::CURRENT) => GitStatus::Current,
            s => {
                warn!("Unknown worktree status {s:?}");
                continue;
            }
        };

        let status = if index_status == GitStatus::Current {
            worktree_status.clone()
        } else {
            index_status.clone()
        };

        let staged = if index_status == GitStatus::Current && worktree_status == GitStatus::Current
        {
            // No change, so can't be added
            false
        } else if index_status != GitStatus::Current {
            true
        } else {
            false
        };

        // Get previous content from Git, if it's in there
        let prev = match head_tree.clone() {
            None => None,
            Some(t) => match t.get_path(&Path::new(&rela_path)) {
                Ok(entry) => {
                    let obj = entry.to_object(&repo)?;
                    let content = obj.as_blob().unwrap().content();
                    let name = Path::new(entry.name().unwrap_or_default());
                    SyncModel::from_bytes(content.into(), name)?.map(|m| m.0)
                }
                Err(_) => None,
            },
        };

        let next = {
            let full_path = repo.workdir().unwrap().join(rela_path.clone());
            SyncModel::from_file(full_path.as_path())?.map(|m| m.0)
        };

        entries.push(GitStatusEntry {
            status,
            staged,
            rela_path,
            prev: prev.clone(),
            next: next.clone(),
        })
    }

    let origins = repo.remotes()?.into_iter().filter_map(|o| Some(o?.to_string())).collect();
    let local_branches = local_branch_names(&repo)?;
    let remote_branches = remote_branch_names(&repo)?;

    Ok(GitStatusSummary {
        entries,
        origins,
        path: dir.to_string_lossy().to_string(),
        head_ref,
        head_ref_shorthand,
        local_branches,
        remote_branches,
    })
}
