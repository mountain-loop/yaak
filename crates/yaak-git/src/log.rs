use crate::repository::open_repo;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_git.ts")]
pub struct GitCommit {
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

pub fn git_log(dir: &Path) -> crate::error::Result<Vec<GitCommit>> {
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

#[cfg(test)]
fn convert_git_time_to_date(_git_time: git2::Time) -> DateTime<Utc> {
    DateTime::from_timestamp(0, 0).unwrap()
}

#[cfg(not(test))]
fn convert_git_time_to_date(git_time: git2::Time) -> DateTime<Utc> {
    let timestamp = git_time.seconds();
    DateTime::from_timestamp(timestamp, 0).unwrap()
}
