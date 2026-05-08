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
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub struct GitBranchInfo {
    pub path: String,
    pub head_ref: Option<String>,
    pub head_ref_shorthand: Option<String>,
    pub origins: Vec<String>,
    pub local_branches: Vec<String>,
    pub remote_branches: Vec<String>,
    pub ahead: u32,
    pub behind: u32,
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

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub struct GitWorktreeStatus {
    pub entries: Vec<GitWorktreeStatusEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub struct GitWorktreeStatusEntry {
    pub rela_path: String,
    pub model_id: Option<String>,
    pub status: GitStatus,
    pub staged: bool,
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

pub fn git_worktree_status(dir: &Path) -> crate::error::Result<GitWorktreeStatus> {
    let repo = open_repo(dir)?;
    let mut opts = git2::StatusOptions::new();
    opts.include_ignored(false)
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_unmodified(false);

    let mut entries = Vec::new();
    for entry in repo.statuses(Some(&mut opts))?.into_iter() {
        let Some(rela_path) = entry.path() else {
            continue;
        };
        let Some((status, staged)) = git_status_from_raw(entry.status()) else {
            continue;
        };

        entries.push(GitWorktreeStatusEntry {
            rela_path: rela_path.to_string(),
            model_id: model_id_from_rela_path(Path::new(rela_path)),
            status,
            staged,
        });
    }

    Ok(GitWorktreeStatus { entries })
}

pub fn git_branch_info(dir: &Path) -> crate::error::Result<GitBranchInfo> {
    let repo = open_repo(dir)?;
    git_branch_info_for_repo(&repo, dir)
}

pub fn git_status(dir: &Path) -> crate::error::Result<GitStatusSummary> {
    let repo = open_repo(dir)?;
    let branch_info = git_branch_info_for_repo(&repo, dir)?;
    let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());

    let mut opts = git2::StatusOptions::new();
    opts.include_ignored(false)
        .include_untracked(true) // Include untracked
        .recurse_untracked_dirs(true) // Show all untracked
        .include_unmodified(true); // Include unchanged

    // TODO: Support renames

    let mut entries: Vec<GitStatusEntry> = Vec::new();
    for entry in repo.statuses(Some(&mut opts))?.into_iter() {
        let rela_path = entry.path().unwrap().to_string();
        let Some((status, staged)) = git_status_from_raw(entry.status()) else {
            continue;
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

    Ok(GitStatusSummary {
        entries,
        path: branch_info.path,
        head_ref: branch_info.head_ref,
        head_ref_shorthand: branch_info.head_ref_shorthand,
        origins: branch_info.origins,
        local_branches: branch_info.local_branches,
        remote_branches: branch_info.remote_branches,
        ahead: branch_info.ahead,
        behind: branch_info.behind,
    })
}

fn git_branch_info_for_repo(
    repo: &git2::Repository,
    dir: &Path,
) -> crate::error::Result<GitBranchInfo> {
    let (head_ref, head_ref_shorthand) = git_head_refs(repo);
    let origins = repo.remotes()?.into_iter().filter_map(|o| Some(o?.to_string())).collect();
    let local_branches = local_branch_names(repo)?;
    let remote_branches = remote_branch_names(repo)?;

    // Compute ahead/behind relative to remote tracking branch
    let (ahead, behind) = (|| -> Option<(usize, usize)> {
        let head = repo.head().ok()?;
        let local_oid = head.target()?;
        let branch_name = head.shorthand()?;
        let upstream_ref =
            repo.find_branch(&format!("origin/{branch_name}"), git2::BranchType::Remote).ok()?;
        let upstream_oid = upstream_ref.get().target()?;
        repo.graph_ahead_behind(local_oid, upstream_oid).ok()
    })()
    .unwrap_or((0, 0));

    Ok(GitBranchInfo {
        path: dir.to_string_lossy().to_string(),
        head_ref,
        head_ref_shorthand,
        origins,
        local_branches,
        remote_branches,
        ahead: ahead as u32,
        behind: behind as u32,
    })
}

fn git_head_refs(repo: &git2::Repository) -> (Option<String>, Option<String>) {
    match repo.head() {
        Ok(head) => {
            let head_ref = head.name().map(|s| s.to_string());
            let head_ref_shorthand = head.shorthand().map(|s| s.to_string());
            (head_ref, head_ref_shorthand)
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
            (head_ref, head_ref_shorthand)
        }
    }
}

fn git_status_from_raw(status: git2::Status) -> Option<(GitStatus, bool)> {
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
            return None;
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
            return None;
        }
    };

    let status =
        if index_status == GitStatus::Current { worktree_status } else { index_status.clone() };
    let staged = index_status != GitStatus::Current;

    Some((status, staged))
}

fn model_id_from_rela_path(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?;
    if ext != "yaml" && ext != "yml" && ext != "json" {
        return None;
    }

    path.file_stem()?.to_str()?.strip_prefix("yaak.").map(String::from)
}
