use crate::error::{Error, Result};
use include_dir::{Dir, include_dir};
use log::info;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::fs::create_dir_all;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use yaak_database::{ConnectionOrTx, DbContext};

pub mod error;
pub mod models;

static MIGRATIONS_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/migrations");

/// Manages the proxy session database pool.
/// Use `connect()` to get a `DbContext` for running queries.
#[derive(Debug, Clone)]
pub struct ProxyDb {
    pool: Arc<Mutex<Pool<SqliteConnectionManager>>>,
}

impl ProxyDb {
    pub fn connect(&self) -> DbContext<'_> {
        let conn = self
            .pool
            .lock()
            .expect("Failed to gain lock on proxy DB")
            .get()
            .expect("Failed to get proxy DB connection from pool");
        DbContext::new(ConnectionOrTx::Connection(conn))
    }
}

pub fn init_standalone(db_path: impl AsRef<Path>) -> Result<ProxyDb> {
    let db_path = db_path.as_ref();

    if let Some(parent) = db_path.parent() {
        create_dir_all(parent)?;
    }

    info!("Initializing proxy session database {db_path:?}");
    let manager = SqliteConnectionManager::file(db_path);
    let pool = Pool::builder()
        .max_size(100)
        .connection_timeout(Duration::from_secs(10))
        .build(manager)
        .map_err(|e| Error::Database(e.to_string()))?;

    pool.get()?.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;",
    )?;

    yaak_database::run_migrations(&pool, &MIGRATIONS_DIR)?;

    Ok(ProxyDb { pool: Arc::new(Mutex::new(pool)) })
}

pub fn init_in_memory() -> Result<ProxyDb> {
    let manager = SqliteConnectionManager::memory();
    let pool = Pool::builder()
        .max_size(1)
        .build(manager)
        .map_err(|e| Error::Database(e.to_string()))?;

    pool.get()?.execute_batch("PRAGMA foreign_keys=ON;")?;

    yaak_database::run_migrations(&pool, &MIGRATIONS_DIR)?;

    Ok(ProxyDb { pool: Arc::new(Mutex::new(pool)) })
}
