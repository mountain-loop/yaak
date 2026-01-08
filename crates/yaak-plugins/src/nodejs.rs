use crate::error::Result;
use log::{info, warn};
use std::net::SocketAddr;
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::watch::Receiver;

/// Start the Node.js plugin runtime process.
///
/// # Arguments
/// * `node_bin_path` - Path to the yaaknode binary
/// * `plugin_runtime_main` - Path to the plugin runtime index.cjs
/// * `addr` - Socket address for the plugin runtime to connect to
/// * `kill_rx` - Channel to signal shutdown
pub async fn start_nodejs_plugin_runtime(
    node_bin_path: &Path,
    plugin_runtime_main: &Path,
    addr: SocketAddr,
    kill_rx: &Receiver<bool>,
) -> Result<()> {
    // HACK: Remove UNC prefix for Windows paths to pass to sidecar
    let plugin_runtime_main_str =
        dunce::simplified(plugin_runtime_main).to_string_lossy().to_string();

    info!(
        "Starting plugin runtime node={} main={}",
        node_bin_path.display(),
        plugin_runtime_main_str
    );

    let mut child = Command::new(node_bin_path)
        .env("HOST", addr.ip().to_string())
        .env("PORT", addr.port().to_string())
        .arg(&plugin_runtime_main_str)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    info!("Spawned plugin runtime");

    // Stream stdout
    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                info!("{}", line);
            }
        });
    }

    // Stream stderr
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                warn!("{}", line);
            }
        });
    }

    // Handle kill signal
    let mut kill_rx = kill_rx.clone();
    tokio::spawn(async move {
        kill_rx.wait_for(|b| *b == true).await.expect("Kill channel errored");
        info!("Killing plugin runtime");
        if let Err(e) = child.kill().await {
            warn!("Failed to kill plugin runtime: {e}");
        }
        info!("Killed plugin runtime");
    });

    Ok(())
}
