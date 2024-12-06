use crate::errors::Error::{GitRepoNotFound, GitUnknown};
use crate::errors::Result;
use chrono::{DateTime, NaiveDateTime};
use git2::{Signature, Status};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "git.ts")]
pub struct GitStatusEntry {
    pub rela_path: String,
    pub index_status: GitStatus,
    pub worktree_status: GitStatus,
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

pub fn git_init(dir: &PathBuf) -> Result<()> {
    git2::Repository::init(dir)?;
    Ok(())
}

pub fn git_add(dir: &PathBuf, path: &str) -> Result<()> {
    let repo = match git2::Repository::open(dir) {
        Ok(r) => r,
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Err(GitRepoNotFound),
        Err(e) => return Err(GitUnknown(e)),
    };

    let mut index = repo.index()?;
    index.add_path(&PathBuf::from(path))?;
    index.write()?;
    Ok(())
}

pub fn git_commit(dir: &PathBuf, message: &str) -> Result<()> {
    let repo = match git2::Repository::open(dir) {
        Ok(r) => r,
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Err(GitRepoNotFound),
        Err(e) => return Err(GitUnknown(e)),
    };
    let config = git2::Config::open_default()?;
    let name = config.get_str("user.name").unwrap_or("Change Me");
    let email = config.get_str("user.email").unwrap_or("change_me@example.com");

    let sig = Signature::now(name, email)?;
    let tree_oid = repo.index()?.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;

    // Get the current HEAD commit (if it exists)
    let parent_commit = match repo.head() {
        Ok(head) => Some(head.peel_to_commit()?),
        Err(_) => None, // No parent if no HEAD exists (initial commit)
    };

    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        message,
        &tree,
        parent_commit.as_ref().map(|p| vec![p]).unwrap_or_default().as_slice(), // Parents
    )?;

    Ok(())
}

pub fn git_log(dir: &PathBuf) -> Result<Vec<GitCommit>> {
    let repo = match git2::Repository::open(dir) {
        Ok(r) => r,
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Err(GitRepoNotFound),
        Err(e) => return Err(GitUnknown(e)),
    };

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

#[cfg(test)]
fn convert_git_time_to_date(_git_time: git2::Time) -> NaiveDateTime {
    DateTime::from_timestamp(0, 0).unwrap().naive_utc()
}

#[cfg(not(test))]
fn convert_git_time_to_date(git_time: git2::Time) -> NaiveDateTime {
    let timestamp = git_time.seconds();
    DateTime::from_timestamp(timestamp, 0).unwrap().naive_utc()
}

pub fn git_status(dir: &PathBuf) -> Result<Vec<GitStatusEntry>> {
    let repo = match git2::Repository::open(dir) {
        Ok(r) => r,
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Err(GitRepoNotFound),
        Err(e) => return Err(GitUnknown(e)),
    };

    let mut opts = git2::StatusOptions::new();
    opts.include_ignored(false)
        .include_untracked(true)
        .include_unmodified(true)
        .recurse_untracked_dirs(true);

    let items: Vec<GitStatusEntry> = repo
        .statuses(Some(&mut opts))?
        .iter()
        .filter_map(|entry| {
            let rela_path = entry.path().unwrap().to_string();
            let status = entry.status();
            let index_status = match status {
                // Note: order matters here, since we're checking a bitmap!
                s if s.contains(Status::CONFLICTED) => GitStatus::Conflict,
                s if s.contains(Status::INDEX_NEW) => GitStatus::Added,
                s if s.contains(Status::INDEX_MODIFIED) => GitStatus::Modified,
                s if s.contains(Status::INDEX_DELETED) => GitStatus::Removed,
                s if s.contains(Status::INDEX_RENAMED) => GitStatus::Renamed,
                s if s.contains(Status::INDEX_TYPECHANGE) => GitStatus::TypeChange,
                s if s.contains(Status::CURRENT) => GitStatus::Current,
                _ => return None,
            };
            let worktree_status = match status {
                // Note: order matters here, since we're checking a bitmap!
                s if s.contains(Status::CONFLICTED) => GitStatus::Conflict,
                s if s.contains(Status::WT_NEW) => GitStatus::Added,
                s if s.contains(Status::WT_MODIFIED) => GitStatus::Modified,
                s if s.contains(Status::WT_DELETED) => GitStatus::Removed,
                s if s.contains(Status::WT_RENAMED) => GitStatus::Renamed,
                s if s.contains(Status::WT_TYPECHANGE) => GitStatus::TypeChange,
                s if s.contains(Status::CURRENT) => GitStatus::Current,
                _ => return None,
            };
            Some(GitStatusEntry {
                index_status,
                worktree_status,
                rela_path,
            })
        })
        .collect();

    Ok(items)
}

// Write a test
#[cfg(test)]
mod test {
    use crate::errors::Error::GitRepoNotFound;
    use crate::git::{
        git_add, git_commit, git_init, git_log, git_status, GitCommit,
        GitStatus, GitStatusEntry,
    };
    use chrono::DateTime;
    use std::fs::File;
    use std::io::Write;
    use std::path::PathBuf;
    use tempdir::TempDir;

    fn new_dir() -> PathBuf {
        TempDir::new("yaak-git").unwrap().into_path()
    }

    fn new_file(path: &PathBuf, content: &str) {
        File::create(path).unwrap().write_all(content.as_bytes()).unwrap();
    }

    #[test]
    fn test_status_no_repo() {
        let dir = &new_dir();
        let result = git_status(dir);
        assert_eq!(Err(GitRepoNotFound), result);
    }

    #[test]
    fn test_status() {
        let dir = &new_dir();
        assert!(git_init(dir).is_ok());

        assert_eq!(git_status(dir), Ok(vec![]),);

        new_file(&dir.join("foo.txt"), "foo");
        new_file(&dir.join("bar.txt"), "foo");
        assert_eq!(
            git_status(dir),
            Ok(vec![
                GitStatusEntry {
                    rela_path: "bar.txt".to_string(),
                    index_status: GitStatus::Current,
                    worktree_status: GitStatus::Added,
                },
                GitStatusEntry {
                    rela_path: "foo.txt".to_string(),
                    index_status: GitStatus::Current,
                    worktree_status: GitStatus::Added,
                },
            ]),
        );
    }

    #[test]
    fn test_add() {
        let dir = &new_dir();
        assert!(git_init(dir).is_ok());

        new_file(&dir.join("foo.txt"), "foo");
        new_file(&dir.join("bar.txt"), "bar");

        assert_eq!(git_add(dir, "foo.txt"), Ok(()));

        assert_eq!(
            git_status(dir),
            Ok(vec![
                GitStatusEntry {
                    rela_path: "bar.txt".to_string(),
                    index_status: GitStatus::Current,
                    worktree_status: GitStatus::Added,
                },
                GitStatusEntry {
                    rela_path: "foo.txt".to_string(),
                    index_status: GitStatus::Added,
                    worktree_status: GitStatus::Current,
                },
            ]),
        );
    }

    #[test]
    fn test_commit() {
        let dir = &new_dir();
        assert!(git_init(dir).is_ok());

        new_file(&dir.join("foo.txt"), "foo");
        new_file(&dir.join("bar.txt"), "bar");

        assert_eq!(git_add(dir, "foo.txt"), Ok(()));
        assert_eq!(git_commit(dir, "This is my message"), Ok(()));

        assert_eq!(
            git_status(dir),
            Ok(vec![
                GitStatusEntry {
                    rela_path: "bar.txt".to_string(),
                    index_status: GitStatus::Current,
                    worktree_status: GitStatus::Added,
                },
                GitStatusEntry {
                    rela_path: "foo.txt".to_string(),
                    index_status: GitStatus::Current,
                    worktree_status: GitStatus::Current,
                },
            ])
        )
    }

    #[test]
    fn test_log() {
        let dir = &new_dir();
        assert!(git_init(dir).is_ok());

        new_file(&dir.join("foo.txt"), "foo");
        new_file(&dir.join("bar.txt"), "bar");

        assert_eq!(git_add(dir, "foo.txt"), Ok(()));
        assert_eq!(git_commit(dir, "This is my message"), Ok(()));

        assert_eq!(
            git_log(dir),
            Ok(vec![GitCommit {
                author: "Change Me <change_me@example.com>".to_string(),
                when: DateTime::from_timestamp(0, 0).unwrap().naive_utc(),
                message: Some("This is my message".to_string()),
            },])
        )
    }
}
