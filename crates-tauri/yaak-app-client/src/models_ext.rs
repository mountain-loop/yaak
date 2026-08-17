//! Tauri-specific extensions for yaak-models.
//!
//! This module provides the Tauri plugin initialization and extension traits
//! that allow accessing QueryManager and BlobManager from Tauri's Manager types.

use chrono::Utc;
use log::error;
use std::time::Duration;
use tauri::plugin::TauriPlugin;
use tauri::{Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use yaak_models::blob_manager::BlobManager;
use yaak_models::client_db::ClientDb;
use yaak_models::error::Result;
use yaak_models::query_manager::QueryManager;
use yaak_models::util::{ModelPayload, UpdateSource};

const MODEL_CHANGES_POLL_INTERVAL_MS: u64 = 1000;
const MODEL_CHANGES_POLL_BATCH_SIZE: usize = 200;

struct ModelChangeCursor {
    created_at: String,
    id: i64,
}

impl ModelChangeCursor {
    fn from_launch_time() -> Self {
        Self {
            created_at: Utc::now().naive_utc().format("%Y-%m-%d %H:%M:%S%.3f").to_string(),
            id: 0,
        }
    }
}

fn drain_model_changes_batch<R: Runtime>(
    query_manager: &QueryManager,
    app_handle: &tauri::AppHandle<R>,
    cursor: &mut ModelChangeCursor,
) -> bool {
    let changes = match query_manager.connect().list_model_changes_since(
        &cursor.created_at,
        cursor.id,
        MODEL_CHANGES_POLL_BATCH_SIZE,
    ) {
        Ok(changes) => changes,
        Err(err) => {
            error!("Failed to poll model_changes rows: {err:?}");
            return false;
        }
    };

    if changes.is_empty() {
        return false;
    }

    let fetched_count = changes.len();
    let mut batch: Vec<ModelPayload> = Vec::with_capacity(fetched_count);
    for change in changes {
        cursor.created_at = change.created_at;
        cursor.id = change.id;

        // Local window-originated writes are forwarded immediately from the
        // in-memory model event channel.
        if matches!(change.payload.update_source, UpdateSource::Window { .. }) {
            continue;
        }
        batch.push(change.payload);
    }

    // Emit as a single batch so bulk writes (imports, sync, CLI) don't flood the
    // frontend with per-model events.
    if !batch.is_empty() {
        if let Err(err) = app_handle.emit("model_writes", batch) {
            error!("Failed to emit model_writes event: {err:?}");
        }
    }

    fetched_count == MODEL_CHANGES_POLL_BATCH_SIZE
}

async fn run_model_change_poller<R: Runtime>(
    query_manager: QueryManager,
    app_handle: tauri::AppHandle<R>,
    mut cursor: ModelChangeCursor,
) {
    loop {
        while drain_model_changes_batch(&query_manager, &app_handle, &mut cursor) {}
        tokio::time::sleep(Duration::from_millis(MODEL_CHANGES_POLL_INTERVAL_MS)).await;
    }
}

/// Extension trait for accessing the QueryManager from Tauri Manager types.
pub trait QueryManagerExt<'a, R> {
    fn db_manager(&'a self) -> State<'a, QueryManager>;
    fn db(&'a self) -> ClientDb<'a>;
    fn with_tx<F, T>(&'a self, func: F) -> Result<T>
    where
        F: FnOnce(&ClientDb) -> Result<T>;
}

impl<'a, R: Runtime, M: Manager<R>> QueryManagerExt<'a, R> for M {
    fn db_manager(&'a self) -> State<'a, QueryManager> {
        self.state::<QueryManager>()
    }

    fn db(&'a self) -> ClientDb<'a> {
        let qm = self.state::<QueryManager>();
        qm.inner().connect()
    }

    fn with_tx<F, T>(&'a self, func: F) -> Result<T>
    where
        F: FnOnce(&ClientDb) -> Result<T>,
    {
        let qm = self.state::<QueryManager>();
        qm.inner().with_tx(func)
    }
}

/// Extension trait for accessing the BlobManager from Tauri Manager types.
pub trait BlobManagerExt<'a, R> {
    fn blob_manager(&'a self) -> State<'a, BlobManager>;
}

impl<'a, R: Runtime, M: Manager<R>> BlobManagerExt<'a, R> for M {
    fn blob_manager(&'a self) -> State<'a, BlobManager> {
        self.state::<BlobManager>()
    }
}

/// Initialize database managers as a plugin (for initialization order).
/// Commands are in the main invoke_handler.
/// This must be registered before other plugins that depend on the database.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("yaak-models-db")
        .setup(|app_handle, _api| {
            let app_path = app_handle.path().app_data_dir().unwrap();
            let db_path = app_path.join("db.sqlite");
            let blob_path = app_path.join("blobs.sqlite");

            let (query_manager, blob_manager, rx) =
                match yaak_models::init_standalone(&db_path, &blob_path) {
                    Ok(result) => result,
                    Err(e) => {
                        app_handle
                            .dialog()
                            .message(e.to_string())
                            .kind(MessageDialogKind::Error)
                            .blocking_show();
                        return Err(Box::from(e.to_string()));
                    }
                };

            // Only stream writes that happen after this app launch.
            let cursor = ModelChangeCursor::from_launch_time();

            let poll_query_manager = query_manager.clone();

            app_handle.manage(query_manager);
            app_handle.manage(blob_manager);

            // Poll model_changes so all writers (including external CLI processes) update the UI.
            let app_handle_poll = app_handle.clone();
            let query_manager = poll_query_manager;
            tauri::async_runtime::spawn(async move {
                run_model_change_poller(query_manager, app_handle_poll, cursor).await;
            });

            // Fast path for local app writes initiated by frontend windows. This keeps the
            // current sync-model UX snappy, while DB polling handles external writers (CLI).
            let app_handle_local = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                while let Ok(payload) = rx.recv() {
                    let mut batch: Vec<ModelPayload> = Vec::new();
                    if matches!(payload.update_source, UpdateSource::Window { .. }) {
                        batch.push(payload);
                    }
                    // Coalesce any writes already queued into the same emit
                    while let Ok(next) = rx.try_recv() {
                        if matches!(next.update_source, UpdateSource::Window { .. }) {
                            batch.push(next);
                        }
                    }
                    if batch.is_empty() {
                        continue;
                    }
                    if let Err(err) = app_handle_local.emit("model_writes", batch) {
                        error!("Failed to emit local model_writes event: {err:?}");
                    }
                }
            });

            Ok(())
        })
        .build()
}
