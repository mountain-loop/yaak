use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use log::info;
use std::path::Path;

pub(crate) fn git_commit(dir: &Path, message: &str) -> crate::error::Result<()> {
    let out = new_binary_command(dir).arg("commit").args(["--message", message]).output()?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = stdout + stderr;

    if !out.status.success() {
        return Err(GenericError(format!("Failed to commit: {}", combined)));
    }

    info!("Committed to {dir:?}");

    Ok(())
}
