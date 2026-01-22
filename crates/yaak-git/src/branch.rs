use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use crate::error::Result;
use std::path::Path;

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

pub async fn git_create_branch(dir: &Path, name: &str) -> Result<()> {
    let out = new_binary_command(dir)
        .await?
        .args(["branch", name])
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to run git branch: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{}{}", stdout, stderr);

    if !out.status.success() {
        return Err(GenericError(format!("Failed to create branch: {}", combined.trim())));
    }

    Ok(())
}

pub async fn git_delete_branch(dir: &Path, name: &str) -> Result<()> {
    // Get current branch name
    let head_out = new_binary_command(dir)
        .await?
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to get current branch: {e}")))?;

    let current_branch = String::from_utf8_lossy(&head_out.stdout).trim().to_string();

    // If trying to delete the current branch, switch to another one first
    if current_branch == name {
        // Get list of local branches
        let branches_out = new_binary_command(dir)
            .await?
            .args(["branch", "--format=%(refname:short)"])
            .output()
            .await
            .map_err(|e| GenericError(format!("failed to list branches: {e}")))?;

        let branches_str = String::from_utf8_lossy(&branches_out.stdout);
        let other_branch = branches_str
            .lines()
            .find(|b| *b != name)
            .ok_or_else(|| GenericError("Cannot delete the only branch".to_string()))?;

        git_checkout_branch(dir, other_branch, true).await?;
    }

    let out = new_binary_command(dir)
        .await?
        .args(["branch", "-d", name])
        .output()
        .await
        .map_err(|e| GenericError(format!("failed to run git branch -d: {e}")))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{}{}", stdout, stderr);

    if !out.status.success() {
        return Err(GenericError(format!("Failed to delete branch: {}", combined.trim())));
    }

    Ok(())
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
