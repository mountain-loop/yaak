use include_dir::{Dir, include_dir};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::path::Path;
use yaak_database::{ConnectionOrTx, DbContext, run_migrations};

static MIGRATIONS: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/migrations");

#[derive(Clone)]
pub struct ProxyQueryManager {
    pool: Pool<SqliteConnectionManager>,
}

impl ProxyQueryManager {
    pub fn new(db_path: &Path) -> Self {
        let manager = SqliteConnectionManager::file(db_path);
        let pool =
            Pool::builder().max_size(5).build(manager).expect("Failed to create proxy DB pool");
        run_migrations(&pool, &MIGRATIONS).expect("Failed to run proxy DB migrations");
        Self { pool }
    }

    pub fn with_conn<F, T>(&self, func: F) -> T
    where
        F: FnOnce(&DbContext) -> T,
    {
        let conn = self.pool.get().expect("Failed to get proxy DB connection");
        let ctx = DbContext::new(ConnectionOrTx::Connection(conn));
        func(&ctx)
    }
}
