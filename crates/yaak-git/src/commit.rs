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
    // Run git from the repo root: command-line pathspecs resolve relative to
    // the working directory, and staged paths are repo-root-relative
    let (workdir, rela_dir) = {
        let repo = open_repo(dir)?;
        let workdir = repo
            .workdir()
            .ok_or_else(|| GenericError("Repository has no worktree".to_string()))?
            .to_path_buf();
        (workdir, repo_relative_dir(&repo, dir))
    };

    let staged = staged_files(&workdir, rela_dir.as_deref()).await?;
    if staged.is_empty() {
        return Err(GenericError("No staged changes to commit".to_string()));
    }

    let mut cmd = new_binary_command(&workdir).await?;
    // --literal-pathspecs: the staged paths are exact files, never patterns
    cmd.arg("--literal-pathspecs");
    cmd.args(["commit", "--message", message, "--"]);
    cmd.args(staged);

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

/// Repo-relative paths of staged changes, limited to `rela_dir` when given.
/// Must be run from the repo root so the pathspec resolves correctly. Uses
/// -z for NUL separation so paths with special characters come through
/// unquoted, --no-renames so staged renames list both sides, and
/// --literal-pathspecs so a scope dir with glob characters isn't a pattern
async fn staged_files(workdir: &Path, rela_dir: Option<&str>) -> crate::error::Result<Vec<String>> {
    let mut cmd = new_binary_command(workdir).await?;
    cmd.arg("--literal-pathspecs");
    cmd.args(["diff", "--cached", "--name-only", "--no-renames", "-z"]);
    if let Some(rela_dir) = rela_dir {
        cmd.args(["--", rela_dir]);
    }
    let out = cmd.output().await?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_staged_files_scoped() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();

        // Scope dir name doubles as a glob pattern; sync1 is its glob decoy
        let sync_dir = tmp.path().join("sync[1]");
        std::fs::create_dir(&sync_dir).unwrap();
        std::fs::write(sync_dir.join("yaak.req_1.yaml"), "inside").unwrap();
        std::fs::create_dir(tmp.path().join("sync1")).unwrap();
        std::fs::write(tmp.path().join("sync1").join("decoy.txt"), "decoy").unwrap();
        std::fs::write(tmp.path().join("outside.txt"), "outside").unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(Path::new("sync[1]/yaak.req_1.yaml")).unwrap();
        index.add_path(Path::new("sync1/decoy.txt")).unwrap();
        index.add_path(Path::new("outside.txt")).unwrap();
        index.write().unwrap();

        let scoped = staged_files(tmp.path(), Some("sync[1]")).await.unwrap();
        assert_eq!(scoped, vec!["sync[1]/yaak.req_1.yaml"]);

        let all = staged_files(tmp.path(), None).await.unwrap();
        assert_eq!(all.len(), 3);
    }
}
