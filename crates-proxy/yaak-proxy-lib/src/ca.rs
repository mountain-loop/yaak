use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CaStatus {
    /// macOS trusts this app's CA, so HTTPS flows can be decrypted.
    pub trusted: bool,
    /// A certificate named "Yaak Proxy CA" is in a keychain: this one, or an older one.
    pub installed: bool,
    pub cert_path: String,
}

#[cfg(target_os = "macos")]
const CA_NAME: &str = "Yaak Proxy CA";
#[cfg(target_os = "macos")]
const SECURITY: &str = "/usr/bin/security";

#[cfg(target_os = "macos")]
pub async fn status(cert_path: &Path) -> Result<CaStatus, String> {
    let installed = security(&["find-certificate", "-c", CA_NAME]).await?.status.success();
    let path = cert_path.to_string_lossy();
    // verify-cert fails both for a missing file and for an older CA trusted under the same name.
    let trusted = installed
        && cert_path.exists()
        && security(&["verify-cert", "-c", &path, "-L", "-q"]).await?.status.success();
    Ok(CaStatus { trusted, installed, cert_path: path.into_owned() })
}

/// Adds the CA to the login keychain as a trusted root. macOS asks for the user's password;
/// the app never elevates.
#[cfg(target_os = "macos")]
pub async fn trust(cert_path: &Path) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    let keychain = Path::new(&home).join("Library/Keychains/login.keychain-db");
    let output = security(&[
        "add-trusted-cert",
        "-r",
        "trustRoot",
        "-k",
        &keychain.to_string_lossy(),
        &cert_path.to_string_lossy(),
    ])
    .await?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() { format!("security exited with {}", output.status) } else { stderr })
}

#[cfg(target_os = "macos")]
async fn security(args: &[&str]) -> Result<std::process::Output, String> {
    tokio::process::Command::new(SECURITY)
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Failed to run {SECURITY}: {e}"))
}

#[cfg(not(target_os = "macos"))]
pub async fn status(cert_path: &Path) -> Result<CaStatus, String> {
    Ok(CaStatus {
        trusted: false,
        installed: false,
        cert_path: cert_path.to_string_lossy().into_owned(),
    })
}

#[cfg(not(target_os = "macos"))]
pub async fn trust(_cert_path: &Path) -> Result<(), String> {
    Err("Trusting the certificate from the app is only supported on macOS".to_string())
}
