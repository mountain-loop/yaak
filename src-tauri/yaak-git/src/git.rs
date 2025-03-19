use crate::error::Result;
use crate::repository::open_repo;
use crate::util::{local_branch_names, remote_branch_names};
use chrono::{DateTime, Utc};
use git2::IndexAddOption;
use log::{info, warn};
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub struct GitCommit {
    author: GitAuthor,
    when: DateTime<Utc>,
    message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub struct GitAuthor {
    name: Option<String>,
    email: Option<String>,
}

pub fn git_init(dir: &Path) -> Result<()> {
    git2::Repository::init(dir)?;
    let repo = open_repo(dir)?;
    // Default to main instead of master, to align with
    // the official Git and GitHub behavior
    repo.set_head("refs/heads/main")?;
    info!("Initialized {dir:?}");
    Ok(())
}

pub fn git_add(dir: &Path, rela_path: &Path) -> Result<()> {
    let repo = open_repo(dir)?;
    let mut index = repo.index()?;

    info!("Staging file {rela_path:?} to {dir:?}");
    index.add_all(&[rela_path], IndexAddOption::DEFAULT, None)?;
    index.write()?;

    Ok(())
}

pub fn git_unstage(dir: &Path, rela_path: &Path) -> Result<()> {
    let repo = open_repo(dir)?;

    let head = match repo.head() {
        Ok(h) => h,
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => {
            info!("Unstaging file in empty branch {rela_path:?} to {dir:?}");
            // Repo has no commits, so "unstage" means remove from index
            let mut index = repo.index()?;
            index.remove_path(rela_path)?;
            index.write()?;
            return Ok(());
        }
        Err(e) => return Err(e.into()),
    };

    // If repo has commits, update the index entry back to HEAD
    info!("Unstaging file {rela_path:?} to {dir:?}");
    let commit = head.peel_to_commit()?;
    repo.reset_default(Some(commit.as_object()), &[rela_path])?;

    Ok(())
}

pub fn git_commit(dir: &Path, message: &str) -> Result<()> {
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

pub fn git_log(dir: &Path) -> Result<Vec<GitCommit>> {
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
            let author = commit.author();
            Some(GitCommit {
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

pub fn git_status(dir: &Path) -> Result<GitStatusSummary> {
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
                    let obj = entry.to_object(&repo).unwrap();
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

#[cfg(test)]
fn convert_git_time_to_date(_git_time: git2::Time) -> DateTime<Utc> {
    DateTime::from_timestamp(0, 0).unwrap()
}

#[cfg(not(test))]
fn convert_git_time_to_date(git_time: git2::Time) -> DateTime<Utc> {
    let timestamp = git_time.seconds();
    DateTime::from_timestamp(timestamp, 0).unwrap()
}

// // Write a test
// #[cfg(test)]
// mod test {
//     use crate::error::Error::GitRepoNotFound;
//     use crate::error::Result;
//     use crate::git::{
//         git_add, git_commit, git_init, git_log, git_status, git_unstage, open_repo, GitStatus,
//         GitStatusEntry,
//     };
//     use std::fs::{create_dir_all, remove_file, File};
//     use std::io::Write;
//     use std::path::{Path, PathBuf};
//     use tempdir::TempDir;
//
//     fn new_dir() -> PathBuf {
//         let p = TempDir::new("yaak-git").unwrap().into_path();
//         p
//     }
//
//     fn new_file(path: &Path, content: &str) {
//         let parent = path.parent().unwrap();
//         create_dir_all(parent).unwrap();
//         File::create(path).unwrap().write_all(content.as_bytes()).unwrap();
//     }
//
//     #[tokio::test]
//     async fn test_status_no_repo() {
//         let dir = &new_dir();
//         let result = git_status(dir).await;
//         assert!(matches!(result, Err(GitRepoNotFound(_))));
//     }
//
//     #[test]
//     fn test_open_repo() -> Result<()> {
//         let dir = &new_dir();
//         git_init(dir)?;
//         open_repo(dir.as_path())?;
//         Ok(())
//     }
//
//     #[test]
//     fn test_open_repo_from_subdir() -> Result<()> {
//         let dir = &new_dir();
//         git_init(dir)?;
//
//         let sub_dir = dir.join("a").join("b");
//         create_dir_all(sub_dir.as_path())?; // Create sub dir
//
//         open_repo(sub_dir.as_path())?;
//         Ok(())
//     }
//
//     #[tokio::test]
//     async fn test_status() -> Result<()> {
//         let dir = &new_dir();
//         git_init(dir)?;
//
//         assert_eq!(git_status(dir).await?.entries, Vec::new());
//
//         new_file(&dir.join("foo.txt"), "foo");
//         new_file(&dir.join("bar.txt"), "bar");
//         new_file(&dir.join("dir/baz.txt"), "baz");
//         assert_eq!(
//             git_status(dir).await?.entries,
//             vec![
//                 GitStatusEntry {
//                     rela_path: "bar.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("bar".to_string()),
//                 },
//                 GitStatusEntry {
//                     rela_path: "dir/baz.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("baz".to_string()),
//                 },
//                 GitStatusEntry {
//                     rela_path: "foo.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("foo".to_string()),
//                 },
//             ],
//         );
//         Ok(())
//     }
//
//     #[tokio::test]
//     fn test_add() -> Result<()> {
//         let dir = &new_dir();
//         git_init(dir)?;
//
//         new_file(&dir.join("foo.txt"), "foo");
//         new_file(&dir.join("bar.txt"), "bar");
//
//         git_add(dir, Path::new("foo.txt"))?;
//
//         assert_eq!(
//             git_status(dir).await?.entries,
//             vec![
//                 GitStatusEntry {
//                     rela_path: "bar.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("bar".to_string()),
//                 },
//                 GitStatusEntry {
//                     rela_path: "foo.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: true,
//                     prev: None,
//                     next: Some("foo".to_string()),
//                 },
//             ],
//         );
//
//         new_file(&dir.join("foo.txt"), "foo foo");
//         assert_eq!(
//             git_status(dir).await?.entries,
//             vec![
//                 GitStatusEntry {
//                     rela_path: "bar.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("bar".to_string()),
//                 },
//                 GitStatusEntry {
//                     rela_path: "foo.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: true,
//                     prev: None,
//                     next: Some("foo foo".to_string()),
//                 },
//             ],
//         );
//         Ok(())
//     }
//
//     #[tokio::test]
//     fn test_unstage() -> Result<()> {
//         let dir = &new_dir();
//         git_init(dir)?;
//
//         new_file(&dir.join("foo.txt"), "foo");
//         new_file(&dir.join("bar.txt"), "bar");
//
//         git_add(dir, Path::new("foo.txt"))?;
//         assert_eq!(
//             git_status(dir).await?.entries,
//             vec![
//                 GitStatusEntry {
//                     rela_path: "bar.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("bar".to_string()),
//                 },
//                 GitStatusEntry {
//                     rela_path: "foo.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: true,
//                     prev: None,
//                     next: Some("foo".to_string()),
//                 },
//             ]
//         );
//
//         git_unstage(dir, Path::new("foo.txt"))?;
//         assert_eq!(
//             git_status(dir).await?.entries,
//             vec![
//                 GitStatusEntry {
//                     rela_path: "bar.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("bar".to_string()),
//                 },
//                 GitStatusEntry {
//                     rela_path: "foo.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("foo".to_string()),
//                 }
//             ]
//         );
//
//         Ok(())
//     }
//
//     #[tokio::test]
//     fn test_commit() -> Result<()> {
//         let dir = &new_dir();
//         git_init(dir)?;
//
//         new_file(&dir.join("foo.txt"), "foo");
//         new_file(&dir.join("bar.txt"), "bar");
//
//         assert_eq!(
//             git_status(dir).await?.entries,
//             vec![
//                 GitStatusEntry {
//                     rela_path: "bar.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("bar".to_string()),
//                 },
//                 GitStatusEntry {
//                     rela_path: "foo.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("foo".to_string()),
//                 },
//             ]
//         );
//
//         git_add(dir, Path::new("foo.txt"))?;
//         git_commit(dir, "This is my message")?;
//
//         assert_eq!(
//             git_status(dir).await?.entries,
//             vec![
//                 GitStatusEntry {
//                     rela_path: "bar.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("bar".to_string()),
//                 },
//                 GitStatusEntry {
//                     rela_path: "foo.txt".to_string(),
//                     status: GitStatus::Current,
//                     staged: false,
//                     prev: Some("foo".to_string()),
//                     next: Some("foo".to_string()),
//                 },
//             ]
//         );
//
//         new_file(&dir.join("foo.txt"), "foo foo");
//         git_add(dir, Path::new("foo.txt"))?;
//         assert_eq!(
//             git_status(dir).await?.entries,
//             vec![
//                 GitStatusEntry {
//                     rela_path: "bar.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("bar".to_string()),
//                 },
//                 GitStatusEntry {
//                     rela_path: "foo.txt".to_string(),
//                     status: GitStatus::Modified,
//                     staged: true,
//                     prev: Some("foo".to_string()),
//                     next: Some("foo foo".to_string()),
//                 },
//             ]
//         );
//         Ok(())
//     }
//
//     #[tokio::test]
//     async fn test_add_removed_file() -> Result<()> {
//         let dir = &new_dir();
//         git_init(dir)?;
//
//         let foo_path = &dir.join("foo.txt");
//         let bar_path = &dir.join("bar.txt");
//
//         new_file(foo_path, "foo");
//         new_file(bar_path, "bar");
//
//         git_add(dir, Path::new("foo.txt"))?;
//         git_commit(dir, "Initial commit")?;
//
//         remove_file(foo_path)?;
//         assert_eq!(
//             git_status(dir).await?.entries,
//             vec![
//                 GitStatusEntry {
//                     rela_path: "bar.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("bar".to_string()),
//                 },
//                 GitStatusEntry {
//                     rela_path: "foo.txt".to_string(),
//                     status: GitStatus::Removed,
//                     staged: false,
//                     prev: Some("foo".to_string()),
//                     next: None,
//                 },
//             ],
//         );
//
//         git_add(dir, Path::new("foo.txt"))?;
//         assert_eq!(
//             git_status(dir).await?.entries,
//             vec![
//                 GitStatusEntry {
//                     rela_path: "bar.txt".to_string(),
//                     status: GitStatus::Added,
//                     staged: false,
//                     prev: None,
//                     next: Some("bar".to_string()),
//                 },
//                 GitStatusEntry {
//                     rela_path: "foo.txt".to_string(),
//                     status: GitStatus::Removed,
//                     staged: true,
//                     prev: Some("foo".to_string()),
//                     next: None,
//                 },
//             ],
//         );
//         Ok(())
//     }
//
//     #[tokio::test]
//     fn test_log_empty() -> Result<()> {
//         let dir = &new_dir();
//         git_init(dir)?;
//
//         let log = git_log(dir)?;
//         assert_eq!(log.len(), 0);
//         Ok(())
//     }
//
//     #[test]
//     fn test_log() -> Result<()> {
//         let dir = &new_dir();
//         git_init(dir)?;
//
//         new_file(&dir.join("foo.txt"), "foo");
//         new_file(&dir.join("bar.txt"), "bar");
//
//         git_add(dir, Path::new("foo.txt"))?;
//         git_commit(dir, "This is my message")?;
//
//         let log = git_log(dir)?;
//         assert_eq!(log.len(), 1);
//         assert_eq!(log.get(0).unwrap().message, Some("This is my message".to_string()));
//         Ok(())
//     }
// }
