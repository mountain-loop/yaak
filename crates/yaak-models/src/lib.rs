use crate::blob_manager::{BlobManager, migrate_blob_db};
use crate::error::Result;
use crate::migrate::migrate_db;
use crate::query_manager::QueryManager;
use crate::util::ModelPayload;
use log::info;
use std::path::Path;
use std::sync::mpsc;
use yaak_database::SqlitePool;

pub mod blob_manager;
pub mod client_db;
pub mod cookies;
mod connection_or_tx;
pub mod error;
pub mod migrate;
pub mod models;
pub mod models_ops;
pub mod path_placeholders;
pub mod queries;
pub mod query_manager;
pub mod render;
pub mod util;

/// Per-connection setup, applied by every pool on every connection it opens.
fn init_connection(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.busy_timeout(std::time::Duration::from_millis(5000))
}

#[cfg(not(target_arch = "wasm32"))]
fn init_file_connection(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    init_connection(conn)
}

/// The two ways a pool comes to exist, one per target.
///
/// On the desktop and CLI, an r2d2 pool over a file. In a browser, a single
/// connection over whatever VFS the host registered before calling in — the
/// path is a name inside that VFS, not a place on disk. Everything downstream
/// of `SqlitePool` is target-agnostic; this is the only fork.
#[cfg(not(target_arch = "wasm32"))]
mod open {
    use super::*;
    use crate::error::Error;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;
    use std::path::PathBuf;
    use std::time::Duration;

    pub fn file_pool(path: impl Into<PathBuf>, max_size: u32, min_idle: u32) -> Result<SqlitePool> {
        let path: PathBuf = path.into();
        // Create parent directories if needed
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let manager = SqliteConnectionManager::file(path).with_init(|c| init_file_connection(c));
        Pool::builder()
            .max_size(max_size)
            .min_idle(Some(min_idle))
            .connection_timeout(Duration::from_secs(10))
            .build(manager)
            .map_err(|e| Error::Database(e.to_string()))
    }

    pub fn memory_pool() -> Result<SqlitePool> {
        let manager = SqliteConnectionManager::memory().with_init(|c| init_connection(c));
        // In-memory DB doesn't support multiple connections
        Pool::builder().max_size(1).build(manager).map_err(|e| Error::Database(e.to_string()))
    }
}

#[cfg(target_arch = "wasm32")]
mod open {
    use super::*;
    use rusqlite::Connection;
    use std::path::PathBuf;

    pub fn file_pool(
        path: impl Into<PathBuf>,
        _max_size: u32,
        _min_idle: u32,
    ) -> Result<SqlitePool> {
        // No WAL: the browser VFSs are single-connection and journal their own
        // way; the pragma is accepted and ignored on some and rejected on
        // others, so it is not applied at all here.
        let conn = Connection::open(path.into())?;
        init_connection(&conn)?;
        Ok(SqlitePool::single(conn))
    }

    pub fn memory_pool() -> Result<SqlitePool> {
        let conn = Connection::open_in_memory()?;
        init_connection(&conn)?;
        Ok(SqlitePool::single(conn))
    }
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

    // Main database pool. Sized for concurrent in-flight queries, not concurrent app
    // features — connections are held per-statement, so even heavy fan-out (e.g. many
    // gRPC streams) only needs a handful at once. Keep max_size modest: WAL connections
    // hold ~3 file descriptors each, and macOS GUI apps get a 256 fd soft limit.
    info!("Initializing app database {db_path:?}");
    let pool = open::file_pool(db_path, 20, 2)?;
    migrate_db(&pool)?;

    info!("Initializing blobs database {blob_path:?}");
    let blob_pool = open::file_pool(blob_path, 10, 1)?;
    migrate_blob_db(&blob_pool)?;

    let (tx, rx) = mpsc::channel();
    let query_manager = QueryManager::new(pool, tx);
    let blob_manager = BlobManager::new(blob_pool);

    Ok((query_manager, blob_manager, rx))
}

/// Initialize the database managers with in-memory SQLite databases.
/// Useful for testing and CI environments.
pub fn init_in_memory() -> Result<(QueryManager, BlobManager, mpsc::Receiver<ModelPayload>)> {
    let pool = open::memory_pool()?;
    migrate_db(&pool)?;

    let blob_pool = open::memory_pool()?;
    migrate_blob_db(&blob_pool)?;

    let (tx, rx) = mpsc::channel();
    let query_manager = QueryManager::new(pool, tx);
    let blob_manager = BlobManager::new(blob_pool);

    Ok((query_manager, blob_manager, rx))
}
