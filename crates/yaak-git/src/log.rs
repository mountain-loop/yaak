use crate::repository::open_repo;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub struct GitCommit {
    pub oid: String,
    pub author: GitAuthor,
    pub when: DateTime<Utc>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub struct GitAuthor {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub struct GitFileDiff {
    pub original: String,
    pub modified: String,
}

pub fn git_log(dir: &Path) -> crate::error::Result<Vec<GitCommit>> {
    git_log_inner(dir, None)
}

pub fn git_log_for_file(dir: &Path, rela_path: &Path) -> crate::error::Result<Vec<GitCommit>> {
    git_log_inner(dir, Some(rela_path))
}

fn git_log_inner(dir: &Path, rela_path: Option<&Path>) -> crate::error::Result<Vec<GitCommit>> {
    let repo = open_repo(dir)?;

    // Return empty if empty repo or no head (new repo)
    if repo.is_empty()? || repo.head().is_err() {
        return Ok(vec![]);
    }

    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(git2::Sort::TIME)?;

    // Run git log
    macro_rules! filter_try {
        ($e:expr) => {
            match $e {
                Ok(t) => t,
                Err(_) => return None,
            }
        };
    }
    let log: Vec<GitCommit> = revwalk
        .filter_map(|oid| {
            let oid = filter_try!(oid);
            let commit = filter_try!(repo.find_commit(oid));
            if let Some(rela_path) = rela_path {
                let touches_path = filter_try!(commit_touches_path(&repo, &commit, rela_path));
                if !touches_path {
                    return None;
                }
            }

            let author = commit.author();
            Some(GitCommit {
                oid: oid.to_string(),
                author: GitAuthor {
                    name: author.name().map(|s| s.to_string()),
                    email: author.email().map(|s| s.to_string()),
                },
                when: convert_git_time_to_date(author.when()),
                message: commit.message().map(|m| m.to_string()),
            })
        })
        .collect();

    Ok(log)
}

pub fn git_file_diff_for_commit(
    dir: &Path,
    commit_oid: &str,
    rela_path: &Path,
) -> crate::error::Result<GitFileDiff> {
    let repo = open_repo(dir)?;
    let oid = git2::Oid::from_str(commit_oid)?;
    let commit = repo.find_commit(oid)?;
    let new_tree = commit.tree()?;
    let old_tree = if commit.parent_count() > 0 { Some(commit.parent(0)?.tree()?) } else { None };

    Ok(GitFileDiff {
        original: blob_text_at_path(&repo, old_tree.as_ref(), rela_path)?,
        modified: blob_text_at_path(&repo, Some(&new_tree), rela_path)?,
    })
}

fn commit_touches_path(
    repo: &git2::Repository,
    commit: &git2::Commit,
    rela_path: &Path,
) -> crate::error::Result<bool> {
    let new_tree = commit.tree()?;
    let old_tree = if commit.parent_count() > 0 { Some(commit.parent(0)?.tree()?) } else { None };

    let mut opts = git2::DiffOptions::new();
    opts.pathspec(rela_path);

    let diff = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut opts))?;
    Ok(diff.deltas().len() > 0)
}

fn blob_text_at_path(
    repo: &git2::Repository,
    tree: Option<&git2::Tree>,
    rela_path: &Path,
) -> crate::error::Result<String> {
    let Some(tree) = tree else {
        return Ok(String::new());
    };
    let Ok(entry) = tree.get_path(rela_path) else {
        return Ok(String::new());
    };
    let blob = entry.to_object(repo)?.peel_to_blob()?;
    Ok(String::from_utf8(blob.content().to_vec())?)
}

#[cfg(test)]
fn convert_git_time_to_date(_git_time: git2::Time) -> DateTime<Utc> {
    DateTime::from_timestamp(0, 0).unwrap()
}

#[cfg(not(test))]
fn convert_git_time_to_date(git_time: git2::Time) -> DateTime<Utc> {
    let timestamp = git_time.seconds();
    DateTime::from_timestamp(timestamp, 0).unwrap()
}
