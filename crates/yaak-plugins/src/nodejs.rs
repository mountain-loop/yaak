use crate::error::Result;
use log::{error, info, warn};
use std::net::SocketAddr;
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::oneshot;
use tokio::sync::watch::Receiver;
use yaak_common::command::new_xplatform_command;

/// Start the Node.js plugin runtime process.
///
/// # Arguments
/// * `node_bin_path` - Path to the yaaknode binary
/// * `plugin_runtime_main` - Path to the plugin runtime index.cjs
/// * `addr` - Socket address for the plugin runtime to connect to
/// * `kill_rx` - Channel to signal shutdown
/// * `killed_tx` - Notified once the runtime is killed after a shutdown signal
/// * `unexpected_exit_tx` - Set to the exit status if the runtime exits
///   without being asked to
pub async fn start_nodejs_plugin_runtime(
    node_bin_path: &Path,
    plugin_runtime_main: &Path,
    addr: SocketAddr,
    kill_rx: &Receiver<bool>,
    killed_tx: oneshot::Sender<()>,
    unexpected_exit_tx: tokio::sync::watch::Sender<Option<String>>,
) -> Result<()> {
    // HACK: Remove UNC prefix for Windows paths to pass to sidecar
    let plugin_runtime_main_str =
        dunce::simplified(plugin_runtime_main).to_string_lossy().to_string();

    info!(
        "Starting plugin runtime node={} main={}",
        node_bin_path.display(),
        plugin_runtime_main_str
    );

    let mut cmd = new_xplatform_command(node_bin_path);
    cmd.env("HOST", addr.ip().to_string())
        .env("PORT", addr.port().to_string())
        .arg(&plugin_runtime_main_str)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn()?;

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

    // Wait for either an explicit kill signal or the child exiting on its own.
    // An unexpected exit is reported to the caller, which decides whether to
    // abort startup or surface a user-facing error.
    let mut kill_rx = kill_rx.clone();
    tokio::spawn(async move {
        tokio::select! {
            status = child.wait() => {
                let status = status.map(|s| s.to_string()).unwrap_or_else(|e| e.to_string());
                error!("Plugin runtime exited unexpectedly ({status})");
                let _ = unexpected_exit_tx.send(Some(status));
            }
            closed = async { kill_rx.wait_for(|b| *b == true).await.is_err() } => {
                if closed {
                    warn!("Kill channel closed before explicit shutdown; terminating plugin runtime");
                }
                info!("Killing plugin runtime");
                if let Err(e) = child.kill().await {
                    warn!("Failed to kill plugin runtime: {e}");
                }
                info!("Killed plugin runtime");
                let _ = killed_tx.send(());
            }
        }
    });

    Ok(())
}
