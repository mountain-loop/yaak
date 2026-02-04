use crate::binary::new_binary_command_global;
use crate::error::Error::GenericError;
use crate::error::Result;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use url::Url;

pub async fn git_add_credential(remote_url: &str, username: &str, password: &str) -> Result<()> {
    let url = Url::parse(remote_url)
        .map_err(|e| GenericError(format!("Failed to parse remote url {remote_url}: {e:?}")))?;
    let protocol = url.scheme();
    let host = url.host_str().unwrap();
    let path = Some(url.path());

    let mut child = new_binary_command_global()
        .await?
        .args(["credential", "approve"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()?;

    {
        let stdin = child.stdin.as_mut().unwrap();
        stdin.write_all(format!("protocol={}\n", protocol).as_bytes()).await?;
        stdin.write_all(format!("host={}\n", host).as_bytes()).await?;
        if let Some(path) = path {
            if !path.is_empty() {
                stdin
                    .write_all(format!("path={}\n", path.trim_start_matches('/')).as_bytes())
                    .await?;
            }
        }
        stdin.write_all(format!("username={}\n", username).as_bytes()).await?;
        stdin.write_all(format!("password={}\n", password).as_bytes()).await?;
        stdin.write_all(b"\n").await?; // blank line terminator
    }

    let status = child.wait().await?;
    if !status.success() {
        return Err(GenericError("Failed to approve git credential".to_string()));
    }

    Ok(())
}
