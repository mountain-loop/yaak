use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use crate::error::Result;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_git.ts")]
pub enum BranchDeleteResult {
    Success { message: String },
    NotFullyMerged,
}

pub async fn git_checkout_branch(dir: &Path, branch_name: &str, force: bool) -> Result<String> {
    let branch_name = branch_name.trim_start_matches("origin/");

    let mut args = vec!["checkout"];
    if force {
        args.push("--force");
    }
    args.push(branch_name);

    let out = new_binary_command(dir)
        .await?
        .args(&args)
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to run git checkout: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{}{}", stdout, stderr);

    if !out.status.success() {
        return Err(GenericError(format!("Failed to checkout: {}", combined.trim())));
    }

    Ok(branch_name.to_string())
}

pub async fn git_create_branch(dir: &Path, name: &str, base: Option<&str>) -> Result<()> {
    let mut cmd = new_binary_command(dir).await?;
    cmd.arg("branch").arg(name);
    if let Some(base_branch) = base {
        cmd.arg(base_branch);
    }

    let out =
        cmd.output().await.map_err(|e| GenericError(format!("failed to run git branch: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{}{}", stdout, stderr);

    if !out.status.success() {
        return Err(GenericError(format!("Failed to create branch: {}", combined.trim())));
    }

    Ok(())
}

pub async fn git_delete_branch(dir: &Path, name: &str, force: bool) -> Result<BranchDeleteResult> {
    let mut cmd = new_binary_command(dir).await?;

    let out =
        if force { cmd.args(["branch", "-D", name]) } else { cmd.args(["branch", "-d", name]) }
            .output()
            .await
            .map_err(|e| GenericError(format!("failed to run git branch -d: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{}{}", stdout, stderr);

    if !out.status.success() && stderr.to_lowercase().contains("not fully merged") {
        return Ok(BranchDeleteResult::NotFullyMerged);
    }

    if !out.status.success() {
        return Err(GenericError(format!("Failed to delete branch: {}", combined.trim())));
    }

    Ok(BranchDeleteResult::Success { message: combined })
}

pub async fn git_merge_branch(dir: &Path, name: &str) -> Result<()> {
    let out = new_binary_command(dir)
        .await?
        .args(["merge", name])
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to run git merge: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{}{}", stdout, stderr);

    if !out.status.success() {
        // Check for merge conflicts
        if combined.to_lowercase().contains("conflict") {
            return Err(GenericError(
                "Merge conflicts detected. Please resolve them manually.".to_string(),
            ));
        }
        return Err(GenericError(format!("Failed to merge: {}", combined.trim())));
    }

    Ok(())
}

pub async fn git_delete_remote_branch(dir: &Path, name: &str) -> Result<()> {
    // Remote branch names come in as "origin/branch-name", extract the branch name
    let branch_name = name.trim_start_matches("origin/");

    let out = new_binary_command(dir)
        .await?
        .args(["push", "origin", "--delete", branch_name])
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to run git push --delete: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{}{}", stdout, stderr);

    if !out.status.success() {
        return Err(GenericError(format!("Failed to delete remote branch: {}", combined.trim())));
    }

    Ok(())
}

pub async fn git_rename_branch(dir: &Path, old_name: &str, new_name: &str) -> Result<()> {
    let out = new_binary_command(dir)
        .await?
        .args(["branch", "-m", old_name, new_name])
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to run git branch -m: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{}{}", stdout, stderr);

    if !out.status.success() {
        return Err(GenericError(format!("Failed to rename branch: {}", combined.trim())));
    }

    Ok(())
}
