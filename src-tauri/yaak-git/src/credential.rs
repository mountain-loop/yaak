use crate::binary::new_binary_command;
use crate::error::Error::GenericError;
use crate::error::Result;
use std::io::Write;
use std::path::Path;
use std::process::Stdio;
use tauri::Url;

pub(crate) async fn git_add_credential(
    dir: &Path,
    remote_url: &str,
    username: &str,
    password: &str,
) -> Result<()> {
    let url = Url::parse(remote_url)
        .map_err(|e| GenericError(format!("Failed to parse remote url {remote_url}: {e:?}")))?;
    let protocol = url.scheme();
    let host = url.host_str().unwrap();
    let path = Some(url.path());

    let mut child = new_binary_command(dir)?
        .args(["credential", "approve"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()?;

    {
        let stdin = child.stdin.as_mut().unwrap();
        writeln!(stdin, "protocol={}", protocol)?;
        writeln!(stdin, "host={}", host)?;
        if let Some(path) = path {
            if !path.is_empty() {
                writeln!(stdin, "path={}", path.trim_start_matches('/'))?;
            }
        }
        writeln!(stdin, "username={}", username)?;
        writeln!(stdin, "password={}", password)?;
        writeln!(stdin)?; // blank line terminator
    }

    let status = child.wait()?;
    if !status.success() {
        return Err(GenericError("Failed to approve git credential".to_string()));
    }

    Ok(())
}
