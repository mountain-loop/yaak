//! Tauri-specific extensions for yaak-sync.
//!
//! This module provides the Tauri commands for sync functionality.

use crate::error::Result;
use crate::models_ext::QueryManagerExt;
use chrono::Utc;
use log::warn;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::ipc::Channel;
use tauri::{AppHandle, Listener, Runtime, command};
use tokio::sync::watch;
use ts_rs::TS;
use yaak_sync::error::Error::InvalidSyncDirectory;
use yaak_sync::sync::{
    FsCandidate, SyncOp, apply_sync_ops, apply_sync_state_ops, compute_sync_ops, get_db_candidates,
    get_fs_candidates,
};
use yaak_sync::watch::{WatchEvent, watch_directory};

#[command]
pub(crate) async fn cmd_sync_calculate<R: Runtime>(
    app_handle: AppHandle<R>,
    workspace_id: &str,
    sync_dir: &Path,
) -> Result<Vec<SyncOp>> {
    if !sync_dir.exists() {
        return Err(InvalidSyncDirectory(sync_dir.to_string_lossy().to_string()).into());
    }

    let db = app_handle.db();
    let version = app_handle.package_info().version.to_string();
    let db_candidates = get_db_candidates(&db, &version, workspace_id, sync_dir)?;
    let fs_candidates = get_fs_candidates(sync_dir)?
        .into_iter()
        // Only keep items in the same workspace
        .filter(|fs| fs.model.workspace_id() == workspace_id)
        .collect::<Vec<FsCandidate>>();
    Ok(compute_sync_ops(db_candidates, fs_candidates))
}

#[command]
pub(crate) async fn cmd_sync_calculate_fs(dir: &Path) -> Result<Vec<SyncOp>> {
    let db_candidates = Vec::new();
    let fs_candidates = get_fs_candidates(dir)?;
    Ok(compute_sync_ops(db_candidates, fs_candidates))
}

#[command]
pub(crate) async fn cmd_sync_apply<R: Runtime>(
    app_handle: AppHandle<R>,
    sync_ops: Vec<SyncOp>,
    sync_dir: &Path,
    workspace_id: &str,
) -> Result<()> {
    let db = app_handle.db();
    let sync_state_ops = apply_sync_ops(&db, workspace_id, sync_dir, sync_ops)?;
    apply_sync_state_ops(&db, workspace_id, sync_dir, sync_state_ops)?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "index.ts")]
pub(crate) struct WatchResult {
    unlisten_event: String,
}

#[command]
pub(crate) async fn cmd_sync_watch<R: Runtime>(
    app_handle: AppHandle<R>,
    sync_dir: &Path,
    workspace_id: &str,
    channel: Channel<WatchEvent>,
) -> Result<WatchResult> {
    let (cancel_tx, cancel_rx) = watch::channel(());

    // Create a callback that forwards events to the Tauri channel
    let callback = move |event: WatchEvent| {
        if let Err(e) = channel.send(event) {
            warn!("Failed to send watch event: {:?}", e);
        }
    };

    watch_directory(&sync_dir, callback, cancel_rx).await?;

    let app_handle_inner = app_handle.clone();
    let unlisten_event =
        format!("watch-unlisten-{}-{}", workspace_id, Utc::now().timestamp_millis());

    // TODO: Figure out a way to unlisten when the client app_handle refreshes or closes. Perhaps with
    //   a heartbeat mechanism, or ensuring only a single subscription per workspace (at least
    //   this won't create `n` subs). We could also maybe have a global fs watcher that we keep
    //   adding to here.
    app_handle.listen_any(unlisten_event.clone(), move |event| {
        app_handle_inner.unlisten(event.id());
        if let Err(e) = cancel_tx.send(()) {
            warn!("Failed to send cancel signal to watcher {e:?}");
        }
    });

    Ok(WatchResult { unlisten_event })
}
