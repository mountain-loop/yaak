use crate::blob_manager::{BlobManager, migrate_blob_db};
use crate::commands::*;
use crate::migrate::migrate_db;
use crate::query_manager::QueryManager;
use log::error;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::fs::create_dir_all;
use std::sync::mpsc;
use std::time::Duration;
use tauri::async_runtime::Mutex;
use tauri::plugin::TauriPlugin;
use tauri::{Emitter, Manager, Runtime, generate_handler};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

mod commands;

pub mod blob_manager;
mod connection_or_tx;
pub mod db_context;
pub mod error;
mod migrate;
pub mod models;
pub mod queries;
pub mod query_manager;
pub mod render;
pub mod util;

pub struct SqliteConnection(pub Mutex<Pool<SqliteConnectionManager>>);

impl SqliteConnection {
    pub(crate) fn new(pool: Pool<SqliteConnectionManager>) -> Self {
        Self(Mutex::new(pool))
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("yaak-models")
        .invoke_handler(generate_handler![
            delete,
            duplicate,
            get_graphql_introspection,
            get_settings,
            grpc_events,
            upsert,
            upsert_graphql_introspection,
            websocket_events,
            workspace_models,
        ])
        .setup(|app_handle, _api| {
            let app_path = app_handle.path().app_data_dir().unwrap();
            create_dir_all(app_path.clone()).expect("Problem creating App directory!");

            let db_file_path = app_path.join("db.sqlite");
            let blob_db_file_path = app_path.join("blobs.sqlite");

            // Main database pool
            let manager = SqliteConnectionManager::file(db_file_path);
            let pool = Pool::builder()
                .max_size(100) // Up from 10 (just in case)
                .connection_timeout(Duration::from_secs(10)) // Down from 30
                .build(manager)
                .unwrap();

            if let Err(e) = migrate_db(&pool) {
                error!("Failed to run database migration {e:?}");
                app_handle
                    .dialog()
                    .message(e.to_string())
                    .kind(MessageDialogKind::Error)
                    .blocking_show();
                return Err(Box::from(e.to_string()));
            };

            // Blob database pool
            let blob_manager = SqliteConnectionManager::file(blob_db_file_path);
            let blob_pool = Pool::builder()
                .max_size(50)
                .connection_timeout(Duration::from_secs(10))
                .build(blob_manager)
                .unwrap();

            if let Err(e) = migrate_blob_db(&blob_pool) {
                error!("Failed to run blob database migration {e:?}");
                app_handle
                    .dialog()
                    .message(e.to_string())
                    .kind(MessageDialogKind::Error)
                    .blocking_show();
                return Err(Box::from(e.to_string()));
            };

            app_handle.manage(SqliteConnection::new(pool.clone()));
            app_handle.manage(BlobManager::new(blob_pool));

            {
                let (tx, rx) = mpsc::channel();
                app_handle.manage(QueryManager::new(pool, tx));
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    for p in rx {
                        app_handle.emit("model_write", p).unwrap();
                    }
                });
            }

            Ok(())
        })
        .build()
}
