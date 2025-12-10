use std::path::Path;
use std::process::{Command, Stdio};
use crate::error::Result;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use crate::error::Error::GitNotFound;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(crate) fn new_binary_command(dir: &Path) -> Result<Command> {
    // 1. Probe that `git` exists and is runnable
    let mut probe = Command::new("git");
    probe.arg("--version").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        probe.creation_flags(CREATE_NO_WINDOW);
    }

    let status = probe.status().map_err(|_| GitNotFound)?;

    if !status.success() {
        return Err(GitNotFound);
    }

    // 2. Build the reusable git command
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir);

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    Ok(cmd)
}
