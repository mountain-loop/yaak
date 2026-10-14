use include_dir::{Dir, include_dir};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Transaction, TransactionBehavior};
use std::path::Path;
use std::time::Duration;
use yaak_database::{ConnectionOrTx, DbContext, Error, Result, SqlitePool, run_migrations};

static MIGRATIONS: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/migrations");

/// Reads come from a pool; writes go through one connection, as in yaak-models'
/// `QueryManager`. WAL lets the CLI read `proxy.db` while the app writes it.
#[derive(Clone)]
pub struct ProxyQueryManager {
    readers: SqlitePool,
    writer: SqlitePool,
}

impl ProxyQueryManager {
    pub fn new(db_path: &Path) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let writer = file_pool(db_path, 1)?;
        run_migrations(&writer, &MIGRATIONS)?;
        Ok(Self { readers: file_pool(db_path, 5)?, writer })
    }

    pub fn with_conn<F, T>(&self, func: F) -> T
    where
        F: FnOnce(&DbContext) -> T,
    {
        let conn = self.readers.get().expect("Failed to get proxy DB connection");
        let ctx = DbContext::new(ConnectionOrTx::Connection(conn));
        func(&ctx)
    }

    /// Run `func` in a transaction on the writer connection.
    pub fn with_tx<T, E>(
        &self,
        func: impl FnOnce(&DbContext) -> std::result::Result<T, E>,
    ) -> std::result::Result<T, E>
    where
        E: From<Error>,
    {
        let conn = self.writer.get().map_err(Error::from)?;
        let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate)
            .map_err(Error::from)?;
        let ctx = DbContext::new(ConnectionOrTx::Transaction(&tx));
        let result = func(&ctx);
        drop(ctx);
        match result {
            Ok(val) => {
                tx.commit().map_err(Error::from)?;
                Ok(val)
            }
            Err(e) => {
                tx.rollback().map_err(Error::from)?;
                Err(e)
            }
        }
    }
}

fn file_pool(path: &Path, max_size: u32) -> Result<SqlitePool> {
    let manager = SqliteConnectionManager::file(path).with_init(|conn| {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(Duration::from_millis(5000))
    });
    Pool::builder()
        .max_size(max_size)
        .connection_timeout(Duration::from_secs(10))
        .build(manager)
        .map_err(|e| Error::Database(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn columns(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})")).unwrap();
        stmt.query_map([], |r| r.get::<_, String>("name")).unwrap().map(|c| c.unwrap()).collect()
    }

    #[test]
    fn migrates_an_old_schema_db() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("proxy.db");

        // The database as the first migration left it, with a row in it.
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(include_str!("../migrations/00000001_init.sql")).unwrap();
        conn.execute_batch(
            "CREATE TABLE _sqlx_migrations (
                version TEXT PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
            );
            INSERT INTO _sqlx_migrations (version, description)
                VALUES ('00000001', '00000001_init.sql');
            INSERT INTO http_exchanges (id, url, method, req_body, res_body)
                VALUES ('he_old', 'https://example.com', 'GET', x'00', x'01');",
        )
        .unwrap();
        drop(conn);

        let db = ProxyQueryManager::new(&path).unwrap();
        drop(db);

        let conn = Connection::open(&path).unwrap();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|t| t.unwrap())
            .collect();
        assert_eq!(tables, vec!["_sqlx_migrations", "flows"]);

        let flow_columns = columns(&conn, "flows");
        assert!(flow_columns.contains(&"response_truncated".to_string()));
        assert!(!flow_columns.iter().any(|c| c.contains("body")), "{flow_columns:?}");

        let journal_mode: String =
            conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
        assert_eq!(journal_mode, "wal");
    }
}
