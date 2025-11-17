use crate::error::Error::GitNotFound;
use crate::error::Result;
use std::path::Path;
use std::process::Command;

pub(crate) fn new_binary_command(dir: &Path) -> Result<Command> {
    let status = Command::new("git").arg("--version").status();

    if let Err(_) = status {
        return Err(GitNotFound);
    }

    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir);
    Ok(cmd)
}
