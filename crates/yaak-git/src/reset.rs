use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use crate::error::Result;
use crate::repository::open_repo;
use crate::status::repo_relative_dir;
use std::path::Path;

pub async fn git_reset_changes(dir: &Path) -> Result<()> {
    let is_subdir = {
        let repo = open_repo(dir)?;
        repo_relative_dir(&repo, dir).is_some()
    };
    let args: &[&str] = if is_subdir {
        &["restore", "--staged", "--worktree", "--", "."]
    } else {
        &["reset", "--hard", "HEAD"]
    };

    let out = new_binary_command(dir)
        .await?
        .args(args)
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to reset changes: {e}")))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(GenericError(format!("Failed to reset changes: {}", stderr.trim())));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn init_repo() -> (tempfile::TempDir, git2::Repository) {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        fs::create_dir(tmp.path().join("sync[1]")).unwrap();
        for path in [
            "sync[1]/request.yaml",
            "sync[1]/deleted.yaml",
            "outside.txt",
        ] {
            fs::write(tmp.path().join(path), "original").unwrap();
        }
        let mut index = repo.index().unwrap();
        index.add_all(["*"], git2::IndexAddOption::DEFAULT, None).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[]).unwrap();
        drop(tree);
        (tmp, repo)
    }

    #[tokio::test]
    async fn reset_subdir_preserves_other_index_and_worktree_changes() {
        let (tmp, repo) = init_repo();
        let sync_dir = tmp.path().join("sync[1]");
        let mut index = repo.index().unwrap();
        for path in ["sync[1]/request.yaml", "sync[1]/added.yaml", "outside.txt"] {
            fs::write(tmp.path().join(path), "staged edit").unwrap();
            index.add_path(Path::new(path)).unwrap();
        }
        index.write().unwrap();
        fs::write(sync_dir.join("request.yaml"), "unstaged edit").unwrap();
        fs::write(tmp.path().join("outside.txt"), "outside worktree edit").unwrap();
        fs::remove_file(sync_dir.join("deleted.yaml")).unwrap();
        fs::write(sync_dir.join("untracked.txt"), "untracked").unwrap();

        git_reset_changes(&sync_dir).await.unwrap();

        assert_eq!(fs::read_to_string(sync_dir.join("request.yaml")).unwrap(), "original");
        assert_eq!(fs::read_to_string(sync_dir.join("deleted.yaml")).unwrap(), "original");
        assert!(!sync_dir.join("added.yaml").exists());
        assert_eq!(fs::read_to_string(sync_dir.join("untracked.txt")).unwrap(), "untracked");
        assert_eq!(
            fs::read_to_string(tmp.path().join("outside.txt")).unwrap(),
            "outside worktree edit"
        );
        assert_eq!(
            repo.status_file(Path::new("sync[1]/request.yaml")).unwrap(),
            git2::Status::CURRENT
        );
        let index = repo.index().unwrap();
        assert!(index.get_path(Path::new("sync[1]/added.yaml"), 0).is_none());
        let outside = index.get_path(Path::new("outside.txt"), 0).unwrap();
        assert_eq!(repo.find_blob(outside.id).unwrap().content(), b"staged edit");
    }

    #[tokio::test]
    async fn reset_repo_root_still_resets_all_changes_and_clears_merge_state() {
        let (tmp, repo) = init_repo();
        fs::write(tmp.path().join("outside.txt"), "staged edit").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("outside.txt")).unwrap();
        index.write().unwrap();
        fs::write(tmp.path().join("outside.txt"), "unstaged edit").unwrap();
        fs::write(tmp.path().join("sync[1]/request.yaml"), "inside edit").unwrap();
        let head = repo.head().unwrap().target().unwrap();
        fs::write(repo.path().join("MERGE_HEAD"), format!("{head}\n")).unwrap();
        assert_eq!(repo.state(), git2::RepositoryState::Merge);

        git_reset_changes(tmp.path()).await.unwrap();

        assert_eq!(fs::read_to_string(tmp.path().join("outside.txt")).unwrap(), "original");
        assert_eq!(
            fs::read_to_string(tmp.path().join("sync[1]/request.yaml")).unwrap(),
            "original"
        );
        assert_eq!(repo.status_file(Path::new("outside.txt")).unwrap(), git2::Status::CURRENT);
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
    }
}
