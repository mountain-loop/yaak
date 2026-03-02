use std::ffi::{OsStr, OsString};
use std::io::{self, ErrorKind};
use std::process::Stdio;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Creates a new `tokio::process::Command` that won't spawn a console window on Windows.
pub fn new_xplatform_command<S: AsRef<OsStr>>(program: S) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Creates a command only if the binary exists and can be invoked with the given probe argument.
pub async fn new_checked_command<S: AsRef<OsStr>>(
    program: S,
    probe_arg: &str,
) -> io::Result<tokio::process::Command> {
    let program: OsString = program.as_ref().to_os_string();

    let mut probe = new_xplatform_command(&program);
    probe.arg(probe_arg).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());

    let status = probe.status().await?;
    if !status.success() {
        return Err(io::Error::new(
            ErrorKind::NotFound,
            format!(
                "'{}' is not available on PATH or failed to execute",
                program.to_string_lossy()
            ),
        ));
    }

    Ok(new_xplatform_command(&program))
}
