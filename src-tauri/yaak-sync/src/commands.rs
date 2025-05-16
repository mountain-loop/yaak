use crate::error::Result;
use crate::sync::{
    apply_sync_ops, apply_sync_state_ops, compute_sync_ops, get_db_candidates, get_fs_candidates, FsCandidate,
    SyncOp,
};
use crate::watch::{watch_directory, WatchEvent};
use chrono::Utc;
use log::warn;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::ipc::Channel;
use tauri::{command, AppHandle, Listener, Runtime};
use tokio::sync::watch;
use ts_rs::TS;

#[command]
pub async fn calculate<R: Runtime>(
    app_handle: AppHandle<R>,
    workspace_id: &str,
    sync_dir: &Path,
) -> Result<Vec<SyncOp>> {
    let db_candidates = get_db_candidates(&app_handle, workspace_id, sync_dir)?;
    let fs_candidates = get_fs_candidates(sync_dir)?
        .into_iter()
        // Only keep items in the same workspace
        .filter(|fs| fs.model.workspace_id() == workspace_id)
        .collect::<Vec<FsCandidate>>();
    // println!("\ndb_candidates: \n{}\n", serde_json::to_string_pretty(&db_candidates)?);
    // println!("\nfs_candidates: \n{}\n", serde_json::to_string_pretty(&fs_candidates)?);
    Ok(compute_sync_ops(db_candidates, fs_candidates))
}

#[command]
pub async fn calculate_fs(dir: &Path) -> Result<Vec<SyncOp>> {
    let db_candidates = Vec::new();
    let fs_candidates = get_fs_candidates(dir)?;
    Ok(compute_sync_ops(db_candidates, fs_candidates))
}

#[command]
pub async fn apply<R: Runtime>(
    app_handle: AppHandle<R>,
    sync_ops: Vec<SyncOp>,
    sync_dir: &Path,
    workspace_id: &str,
) -> Result<()> {
    let sync_state_ops = apply_sync_ops(&app_handle, &workspace_id, sync_dir, sync_ops)?;
    apply_sync_state_ops(&app_handle, workspace_id, sync_dir, sync_state_ops)
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_watch.ts")]
pub(crate) struct WatchResult {
    unlisten_event: String,
}

#[command]
pub async fn watch<R: Runtime>(
    app_handle: AppHandle<R>,
    sync_dir: &Path,
    workspace_id: &str,
    channel: Channel<WatchEvent>,
) -> Result<WatchResult> {
    let (cancel_tx, cancel_rx) = watch::channel(());

    watch_directory(&sync_dir, channel, cancel_rx).await?;

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
