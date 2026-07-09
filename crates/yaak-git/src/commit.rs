use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use crate::repository::open_repo;
use crate::status::repo_relative_dir;
use log::info;
use std::path::Path;

/// Commit the staged changes within `dir` (their current worktree content,
/// matching what the commit dialog displays). Scoping the commit to the sync
/// directory means files staged outside of it (e.g. elsewhere in a containing
/// monorepo) are never swept into a Yaak commit — they stay staged for the
/// user's own next commit.
pub async fn git_commit(dir: &Path, message: &str) -> crate::error::Result<()> {
    let repo = open_repo(dir)?;
    let rela_dir = repo_relative_dir(&repo, dir);

    let staged = staged_files(dir).await?;
    let scoped = filter_paths_to_dir(staged, rela_dir.as_deref());
    if scoped.is_empty() {
        return Err(GenericError("No staged changes to commit".to_string()));
    }

    let mut cmd = new_binary_command(dir).await?;
    cmd.args(["commit", "--message", message, "--"]);
    cmd.args(scoped);

    let out = cmd.output().await?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = stdout + stderr;

    if !out.status.success() {
        return Err(GenericError(format!("Failed to commit: {}", combined)));
    }

    info!("Committed to {dir:?}");

    Ok(())
}

/// Repo-relative paths of all staged changes. Uses -z for NUL separation so
/// paths with special characters come through unquoted, and --no-renames so
/// staged renames list both sides
async fn staged_files(dir: &Path) -> crate::error::Result<Vec<String>> {
    let out = new_binary_command(dir)
        .await?
        .args(["diff", "--cached", "--name-only", "--no-renames", "-z"])
        .output()
        .await?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(GenericError(format!("Failed to list staged files: {}", stderr)));
    }

    Ok(String::from_utf8_lossy(&out.stdout)
        .split('\0')
        .filter(|p| !p.is_empty())
        .map(String::from)
        .collect())
}

fn filter_paths_to_dir(paths: Vec<String>, rela_dir: Option<&str>) -> Vec<String> {
    let Some(rela_dir) = rela_dir else {
        return paths;
    };
    let prefix = format!("{rela_dir}/");
    paths.into_iter().filter(|p| p.starts_with(&prefix)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_paths_to_dir() {
        let paths = vec![
            "sync/yaak.req_1.yaml".to_string(),
            "sync/README.md".to_string(),
            "outside.txt".to_string(),
            "synced/decoy.txt".to_string(),
        ];

        let scoped = filter_paths_to_dir(paths.clone(), Some("sync"));
        assert_eq!(scoped, vec!["sync/yaak.req_1.yaml", "sync/README.md"]);

        // No rela dir (sync dir is the repo root) keeps everything
        assert_eq!(filter_paths_to_dir(paths.clone(), None), paths);
    }
}
