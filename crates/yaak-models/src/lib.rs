use crate::blob_manager::{BlobManager, migrate_blob_db};
use crate::error::{Error, Result};
use crate::migrate::migrate_db;
use crate::query_manager::QueryManager;
use crate::util::ModelPayload;
use log::info;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::fs::create_dir_all;
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

pub mod blob_manager;
mod connection_or_tx;
pub mod db_context;
pub mod error;
pub mod migrate;
pub mod models;
pub mod queries;
pub mod query_manager;
pub mod render;
pub mod util;

/// Initialize the database managers for standalone (non-Tauri) usage.
///
/// Returns a tuple of (QueryManager, BlobManager, event_receiver).
/// The event_receiver can be used to listen for model change events.
pub fn init_standalone(
    db_path: impl AsRef<Path>,
    blob_path: impl AsRef<Path>,
) -> Result<(QueryManager, BlobManager, mpsc::Receiver<ModelPayload>)> {
    let db_path = db_path.as_ref();
    let blob_path = blob_path.as_ref();

    // Create parent directories if needed
    if let Some(parent) = db_path.parent() {
        create_dir_all(parent)?;
    }
    if let Some(parent) = blob_path.parent() {
        create_dir_all(parent)?;
    }

    // Main database pool
    info!("Initializing app database {db_path:?}");
    let manager = SqliteConnectionManager::file(db_path);
    let pool = Pool::builder()
        .max_size(100)
        .connection_timeout(Duration::from_secs(10))
        .build(manager)
        .map_err(|e| Error::Database(e.to_string()))?;

    migrate_db(&pool)?;

    info!("Initializing blobs database {blob_path:?}");

    // Blob database pool
    let blob_manager = SqliteConnectionManager::file(blob_path);
    let blob_pool = Pool::builder()
        .max_size(50)
        .connection_timeout(Duration::from_secs(10))
        .build(blob_manager)
        .map_err(|e| Error::Database(e.to_string()))?;

    migrate_blob_db(&blob_pool)?;

    let (tx, rx) = mpsc::channel();
    let query_manager = QueryManager::new(pool, tx);
    let blob_manager = BlobManager::new(blob_pool);

    Ok((query_manager, blob_manager, rx))
}

/// Initialize the database managers with in-memory SQLite databases.
/// Useful for testing and CI environments.
pub fn init_in_memory() -> Result<(QueryManager, BlobManager, mpsc::Receiver<ModelPayload>)> {
    // Main database pool
    let manager = SqliteConnectionManager::memory();
    let pool = Pool::builder()
        .max_size(1) // In-memory DB doesn't support multiple connections
        .build(manager)
        .map_err(|e| Error::Database(e.to_string()))?;

    migrate_db(&pool)?;

    // Blob database pool
    let blob_manager = SqliteConnectionManager::memory();
    let blob_pool = Pool::builder()
        .max_size(1)
        .build(blob_manager)
        .map_err(|e| Error::Database(e.to_string()))?;

    migrate_blob_db(&blob_pool)?;

    let (tx, rx) = mpsc::channel();
    let query_manager = QueryManager::new(pool, tx);
    let blob_manager = BlobManager::new(blob_pool);

    Ok((query_manager, blob_manager, rx))
}
