use crate::error::Error::{GitRepoNotFound, GitUnknown};
use crate::error::Result;
use chrono::{DateTime, NaiveDateTime};
use git2::IndexAddOption;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::str::from_utf8;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "git.ts")]
pub struct GitStatusEntry {
    pub rela_path: String,
    pub status: GitStatus,
    pub staged: bool,
    pub prev: Option<String>,
    pub next: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "git.ts")]
pub enum GitStatus {
    Added,
    Conflict,
    Current,
    Modified,
    Removed,
    Renamed,
    TypeChange,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "git.ts")]
pub struct GitCommit {
    author: String,
    when: NaiveDateTime,
    message: Option<String>,
}

pub fn git_init(dir: &Path) -> Result<()> {
    git2::Repository::init(dir)?;
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

    info!("Unstaging file {rela_path:?} to {dir:?}");

    if repo.is_empty()? {
        // Repo has no commits, so "unstage" means remove from index
        let mut index = repo.index()?;
        index.remove_path(rela_path)?;
        index.write()?;
        return Ok(());
    }

    // If repo has commits, update the index entry back to HEAD
    let commit = repo.head()?.peel_to_commit()?;
    repo.reset_default(Some(commit.as_object()), &[rela_path])?;

    Ok(())
}

pub fn git_commit(dir: &Path, message: &str) -> Result<()> {
    let repo = open_repo(dir)?;

    // Clear the in-memory index, add the paths, and write the tree for committing
    let tree_oid = repo.index()?.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;

    // Make the signature
    let config = git2::Config::open_default()?.snapshot()?;
    let name = config.get_str("user.name").unwrap_or("Change Me");
    let email = config.get_str("user.email").unwrap_or("change_me@example.com");
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
                author: author.to_string(),
                when: convert_git_time_to_date(author.when()),
                message: commit.message().map(|m| m.to_string()),
            })
        })
        .collect();

    Ok(log)
}

pub fn git_status(dir: &Path) -> Result<Vec<GitStatusEntry>> {
    let repo = open_repo(dir)?;
    let head_tree = match repo.head() {
        Ok(head) => head.peel_to_tree().ok(),
        Err(_) => None,
    };

    let mut opts = git2::StatusOptions::new();
    opts.include_ignored(false)
        .include_untracked(true) // Include untracked
        .recurse_untracked_dirs(true) // Show all untracked
        .include_unmodified(true); // Include unchanged

    // TODO: Support renames

    let items: Vec<GitStatusEntry> = repo
        .statuses(Some(&mut opts))?
        .iter()
        .filter_map(|entry| {
            let rela_path = entry.path().unwrap().to_string();
            let status = entry.status();
            let index_status = match status {
                // Note: order matters here, since we're checking a bitmap!
                s if s.contains(git2::Status::CONFLICTED) => GitStatus::Conflict,
                s if s.contains(git2::Status::INDEX_NEW) => GitStatus::Added,
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
                s if s.contains(git2::Status::WT_NEW) => GitStatus::Added,
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

            let status = if index_status == GitStatus::Current {
                worktree_status.clone()
            } else {
                index_status.clone()
            };

            let staged =
                if index_status == GitStatus::Current && worktree_status == GitStatus::Current {
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
                        Some(from_utf8(content).unwrap().to_string())
                    }
                    Err(_) => None,
                },
            };

            let next = {
                let full_path = repo.workdir().unwrap().join(rela_path.clone());
                fs::read_to_string(full_path.clone()).ok()
            };

            // // Look up the content, either from the Git index or the filesystem (if not in Git yet)
            // let content = match index.iter().find(|e| {
            //     let p = from_utf8(e.path.as_slice()).unwrap().to_string();
            //     return rela_path == p;
            // }) {
            //     None => {
            //         if status.clone() == GitStatus::Removed {
            //             let obj = head_tree
            //                 .clone()
            //                 .unwrap()
            //                 .get_path(&Path::new(&rela_path))
            //                 .unwrap()
            //                 .to_object(&repo)
            //                 .unwrap();
            //             let content = obj.as_blob().unwrap().content();
            //             from_utf8(content).unwrap().to_string()
            //         } else {
            //             let full_path = repo.workdir().unwrap().join(rela_path.clone());
            //             fs::read_to_string(full_path.clone()).expect(
            //                 format!("Failed to read file {full_path:?} {status:?}").as_str(),
            //             )
            //         }
            //     }
            //     Some(e) => {
            //         let blob = repo.find_blob(e.id).unwrap();
            //         let content = blob.content();
            //         from_utf8(content).unwrap().to_string()
            //     }
            // };

            // let value: Value = serde_yaml::from_str(&content).unwrap();
            // let value_map = value.as_mapping().unwrap();
            // let model: AnyModel = match value_map.get("model") {
            //     None => { panic!("Model did not have model attribute") }
            //     Some(m) => match m.as_str().unwrap() {
            //         "workspace" => { AnyModel::Workspace(serde_yaml::from_value(value).unwrap()) }
            //         "environment" => { AnyModel::Environment(serde_yaml::from_value(value).unwrap()) }
            //         "grpc_request" => { AnyModel::GrpcRequest(serde_yaml::from_value(value).unwrap()) }
            //         "http_request" => { AnyModel::HttpRequest(serde_yaml::from_value(value).unwrap()) }
            //         "folder" => { AnyModel::Folder(serde_yaml::from_value(value).unwrap()) }
            //         _ => { panic!("Model did not have model attribute") }
            //     }
            // };

            Some(GitStatusEntry {
                status,
                staged,
                rela_path,
                prev,
                next,
            })
        })
        .collect();

    Ok(items)
}

fn open_repo(dir: &Path) -> Result<git2::Repository> {
    match git2::Repository::discover(dir) {
        Ok(r) => Ok(r),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Err(GitRepoNotFound(dir.to_path_buf())),
        Err(e) => Err(GitUnknown(e)),
    }
}

#[cfg(test)]
fn convert_git_time_to_date(_git_time: git2::Time) -> NaiveDateTime {
    DateTime::from_timestamp(0, 0).unwrap().naive_utc()
}

#[cfg(not(test))]
fn convert_git_time_to_date(git_time: git2::Time) -> NaiveDateTime {
    let timestamp = git_time.seconds();
    DateTime::from_timestamp(timestamp, 0).unwrap().naive_utc()
}

// Write a test
#[cfg(test)]
mod test {
    use crate::error::Error::GitRepoNotFound;
    use crate::error::Result;
    use crate::git::{
        git_add, git_commit, git_init, git_log, git_status, git_unstage, open_repo, GitStatus,
        GitStatusEntry,
    };
    use std::fs::{create_dir_all, remove_file, File};
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use tempdir::TempDir;

    fn new_dir() -> PathBuf {
        let p = TempDir::new("yaak-git").unwrap().into_path();
        p
    }

    fn new_file(path: &Path, content: &str) {
        let parent = path.parent().unwrap();
        create_dir_all(parent).unwrap();
        File::create(path).unwrap().write_all(content.as_bytes()).unwrap();
    }

    #[test]
    fn test_status_no_repo() {
        let dir = &new_dir();
        let result = git_status(dir);
        assert!(matches!(result, Err(GitRepoNotFound(_))));
    }

    #[test]
    fn test_open_repo() -> Result<()> {
        let dir = &new_dir();
        git_init(dir)?;
        open_repo(dir.as_path())?;
        Ok(())
    }

    #[test]
    fn test_open_repo_from_subdir() -> Result<()> {
        let dir = &new_dir();
        git_init(dir)?;

        let sub_dir = dir.join("a").join("b");
        create_dir_all(sub_dir.as_path())?; // Create sub dir

        open_repo(sub_dir.as_path())?;
        Ok(())
    }

    #[test]
    fn test_status() -> Result<()> {
        let dir = &new_dir();
        git_init(dir)?;

        assert_eq!(git_status(dir)?, Vec::new());

        new_file(&dir.join("foo.txt"), "foo");
        new_file(&dir.join("bar.txt"), "bar");
        new_file(&dir.join("dir/baz.txt"), "baz");
        assert_eq!(
            git_status(dir)?,
            vec![
                GitStatusEntry {
                    rela_path: "bar.txt".to_string(),
                    status: GitStatus::Added,
                    staged: false,
                    prev: None,
                    next: Some("bar".to_string()),
                },
                GitStatusEntry {
                    rela_path: "dir/baz.txt".to_string(),
                    status: GitStatus::Added,
                    staged: false,
                    prev: None,
                    next: Some("baz".to_string()),
                },
                GitStatusEntry {
                    rela_path: "foo.txt".to_string(),
                    status: GitStatus::Added,
                    staged: false,
                    prev: None,
                    next: Some("foo".to_string()),
                },
            ],
        );
        Ok(())
    }

    #[test]
    fn test_add() -> Result<()> {
        let dir = &new_dir();
        git_init(dir)?;

        new_file(&dir.join("foo.txt"), "foo");
        new_file(&dir.join("bar.txt"), "bar");

        git_add(dir, Path::new("foo.txt"))?;

        assert_eq!(
            git_status(dir)?,
            vec![
                GitStatusEntry {
                    rela_path: "bar.txt".to_string(),
                    status: GitStatus::Added,
                    staged: false,
                    prev: None,
                    next: Some("bar".to_string()),
                },
                GitStatusEntry {
                    rela_path: "foo.txt".to_string(),
                    status: GitStatus::Added,
                    staged: true,
                    prev: None,
                    next: Some("foo".to_string()),
                },
            ],
        );

        new_file(&dir.join("foo.txt"), "foo foo");
        assert_eq!(
            git_status(dir)?,
            vec![
                GitStatusEntry {
                    rela_path: "bar.txt".to_string(),
                    status: GitStatus::Added,
                    staged: false,
                    prev: None,
                    next: Some("bar".to_string()),
                },
                GitStatusEntry {
                    rela_path: "foo.txt".to_string(),
                    status: GitStatus::Added,
                    staged: true,
                    prev: None,
                    next: Some("foo foo".to_string()),
                },
            ],
        );
        Ok(())
    }

    #[test]
    fn test_unstage() -> Result<()> {
        let dir = &new_dir();
        git_init(dir)?;

        new_file(&dir.join("foo.txt"), "foo");
        git_add(dir, Path::new("foo.txt"))?;
        assert_eq!(
            git_status(dir)?,
            vec![GitStatusEntry {
                rela_path: "foo.txt".to_string(),
                status: GitStatus::Added,
                staged: true,
                prev: None,
                next: Some("foo".to_string()),
            }]
        );

        git_unstage(dir, Path::new("foo.txt"))?;
        assert_eq!(
            git_status(dir)?,
            vec![GitStatusEntry {
                rela_path: "foo.txt".to_string(),
                status: GitStatus::Added,
                staged: false,
                prev: None,
                next: Some("foo".to_string()),
            }]
        );

        Ok(())
    }

    #[test]
    fn test_commit() -> Result<()> {
        let dir = &new_dir();
        git_init(dir)?;

        new_file(&dir.join("foo.txt"), "foo");
        new_file(&dir.join("bar.txt"), "bar");

        assert_eq!(
            git_status(dir)?,
            vec![
                GitStatusEntry {
                    rela_path: "bar.txt".to_string(),
                    status: GitStatus::Added,
                    staged: false,
                    prev: None,
                    next: Some("bar".to_string()),
                },
                GitStatusEntry {
                    rela_path: "foo.txt".to_string(),
                    status: GitStatus::Added,
                    staged: false,
                    prev: None,
                    next: Some("foo".to_string()),
                },
            ]
        );

        git_add(dir, Path::new("foo.txt"))?;
        git_commit(dir, "This is my message")?;

        assert_eq!(
            git_status(dir)?,
            vec![
                GitStatusEntry {
                    rela_path: "bar.txt".to_string(),
                    status: GitStatus::Added,
                    staged: false,
                    prev: None,
                    next: Some("bar".to_string()),
                },
                GitStatusEntry {
                    rela_path: "foo.txt".to_string(),
                    status: GitStatus::Current,
                    staged: false,
                    prev: Some("foo".to_string()),
                    next: Some("foo".to_string()),
                },
            ]
        );

        new_file(&dir.join("foo.txt"), "foo foo");
        git_add(dir, Path::new("foo.txt"))?;
        assert_eq!(
            git_status(dir)?,
            vec![
                GitStatusEntry {
                    rela_path: "bar.txt".to_string(),
                    status: GitStatus::Added,
                    staged: false,
                    prev: None,
                    next: Some("bar".to_string()),
                },
                GitStatusEntry {
                    rela_path: "foo.txt".to_string(),
                    status: GitStatus::Modified,
                    staged: true,
                    prev: Some("foo".to_string()),
                    next: Some("foo foo".to_string()),
                },
            ]
        );
        Ok(())
    }

    #[test]
    fn test_add_removed_file() -> Result<()> {
        let dir = &new_dir();
        git_init(dir)?;

        let foo_path = &dir.join("foo.txt");
        let bar_path = &dir.join("bar.txt");

        new_file(foo_path, "foo");
        new_file(bar_path, "bar");

        git_add(dir, Path::new("foo.txt"))?;
        git_commit(dir, "Initial commit")?;

        remove_file(foo_path)?;
        assert_eq!(
            git_status(dir)?,
            vec![
                GitStatusEntry {
                    rela_path: "bar.txt".to_string(),
                    status: GitStatus::Added,
                    staged: false,
                    prev: None,
                    next: Some("bar".to_string()),
                },
                GitStatusEntry {
                    rela_path: "foo.txt".to_string(),
                    status: GitStatus::Removed,
                    staged: false,
                    prev: Some("foo".to_string()),
                    next: None,
                },
            ],
        );

        git_add(dir, Path::new("foo.txt"))?;
        assert_eq!(
            git_status(dir)?,
            vec![
                GitStatusEntry {
                    rela_path: "bar.txt".to_string(),
                    status: GitStatus::Added,
                    staged: false,
                    prev: None,
                    next: Some("bar".to_string()),
                },
                GitStatusEntry {
                    rela_path: "foo.txt".to_string(),
                    status: GitStatus::Removed,
                    staged: true,
                    prev: Some("foo".to_string()),
                    next: None,
                },
            ],
        );
        Ok(())
    }

    #[test]
    fn test_log() -> Result<()> {
        let dir = &new_dir();
        git_init(dir)?;

        new_file(&dir.join("foo.txt"), "foo");
        new_file(&dir.join("bar.txt"), "bar");

        git_add(dir, Path::new("foo.txt"))?;
        git_commit(dir, "This is my message")?;

        let log = git_log(dir)?;
        assert_eq!(log.len(), 1);
        assert_eq!(log.get(0).unwrap().message, Some("This is my message".to_string()));
        Ok(())
    }
}
