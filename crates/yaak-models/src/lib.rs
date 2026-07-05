use crate::blob_manager::{BlobManager, migrate_blob_db};
use crate::error::{Error, Result};
use crate::migrate::migrate_db;
use crate::query_manager::QueryManager;
use crate::util::ModelPayload;
use log::info;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::fs::create_dir_all;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

pub mod blob_manager;
pub mod client_db;
mod connection_or_tx;
pub mod error;
pub mod migrate;
pub mod models;
pub mod queries;
pub mod query_manager;
pub mod render;
pub mod util;

fn sqlite_file_manager(path: impl Into<PathBuf>) -> SqliteConnectionManager {
    SqliteConnectionManager::file(path.into()).with_init(|conn| {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(Duration::from_millis(5000))
    })
}

fn sqlite_memory_manager() -> SqliteConnectionManager {
    SqliteConnectionManager::memory()
        .with_init(|conn| conn.busy_timeout(Duration::from_millis(5000)))
}

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

    // Main database pool. Sized for concurrent in-flight queries, not concurrent app
    // features — connections are held per-statement, so even heavy fan-out (e.g. many
    // gRPC streams) only needs a handful at once. Keep max_size modest: WAL connections
    // hold ~3 file descriptors each, and macOS GUI apps get a 256 fd soft limit.
    info!("Initializing app database {db_path:?}");
    let manager = sqlite_file_manager(db_path);
    let pool = Pool::builder()
        .max_size(20)
        .min_idle(Some(2))
        .connection_timeout(Duration::from_secs(10))
        .build(manager)
        .map_err(|e| Error::Database(e.to_string()))?;

    migrate_db(&pool)?;

    info!("Initializing blobs database {blob_path:?}");

    // Blob database pool
    let blob_manager = sqlite_file_manager(blob_path);
    let blob_pool = Pool::builder()
        .max_size(10)
        .min_idle(Some(1))
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
    let manager = sqlite_memory_manager();
    let pool = Pool::builder()
        .max_size(1) // In-memory DB doesn't support multiple connections
        .build(manager)
        .map_err(|e| Error::Database(e.to_string()))?;

    migrate_db(&pool)?;

    // Blob database pool
    let blob_manager = sqlite_memory_manager();
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
