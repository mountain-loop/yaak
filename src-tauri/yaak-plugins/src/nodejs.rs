use crate::error::Result;
use log::{info, warn};
use std::net::SocketAddr;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::sync::watch::Receiver;

pub async fn start_nodejs_plugin_runtime<R: Runtime>(
    app: &AppHandle<R>,
    addr: SocketAddr,
    kill_rx: &Receiver<bool>,
) -> Result<()> {
    let plugin_runtime_main =
        app.path().resolve("vendored/plugin-runtime", BaseDirectory::Resource)?.join("index.cjs");

    // HACK: Remove UNC prefix for Windows paths to pass to sidecar
    let plugin_runtime_main =
        dunce::simplified(plugin_runtime_main.as_path()).to_string_lossy().to_string();

    info!("Starting plugin runtime main={}", plugin_runtime_main);

    let cmd = app
        .shell()
        .sidecar("yaaknode")?
        .env("PORT", addr.port().to_string())
        .args(&[&plugin_runtime_main]);

    let (mut child_rx, child) = cmd.spawn()?;
    info!("Spawned plugin runtime");

    let mut kill_rx = kill_rx.clone();

    tokio::spawn(async move {
        while let Some(event) = child_rx.recv().await {
            match event {
                CommandEvent::Stderr(line) => {
                    warn!("{}", String::from_utf8_lossy(&line).trim_end_matches(&['\n', '\r'][..]));
                }
                CommandEvent::Stdout(line) => {
                    info!("{}", String::from_utf8_lossy(&line).trim_end_matches(&['\n', '\r'][..]));
                }
                _ => {}
            }
        }
    });

    // Check on child
    tokio::spawn(async move {
        kill_rx.wait_for(|b| *b == true).await.expect("Kill channel errored");
        info!("Killing plugin runtime");
        child.kill().expect("Failed to kill plugin runtime");
        info!("Killed plugin runtime");
    });

    Ok(())
}
