use include_dir::{Dir, include_dir};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::functions::FunctionFlags;
use rusqlite::{OpenFlags, Transaction, TransactionBehavior};
use std::path::Path;
use std::time::Duration;
use yaak_database::{ConnectionOrTx, DbContext, Error, Result, SqlitePool, run_migrations};
use yaak_models::blob_manager::BlobManager;

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

    /// `proxy.db` for reading while another process may be writing it, or none is. Writes
    /// fail. No migrations run, so an older database reads as it is.
    pub fn open_read_only(db_path: &Path) -> Result<Self> {
        let readers = read_only_pool(db_path)?;
        Ok(Self { writer: readers.clone(), readers })
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

/// `blobs.sqlite` for reading, alongside [`ProxyQueryManager::open_read_only`].
pub fn open_blobs_read_only(path: &Path) -> Result<BlobManager> {
    let readers = read_only_pool(path)?;
    Ok(BlobManager::new(readers.clone(), readers))
}

/// The functions filters use: `sidebar_path(url)`, the app sidebar's place for a URL, and
/// `under_site(url, site)`, for filtering by its nodes; `folder_name(dir)`, for naming a program
/// by its folder; and `is_system(bundle_id, path)`, for macOS's own daemons.
fn add_functions(conn: &mut rusqlite::Connection) -> rusqlite::Result<()> {
    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
    conn.create_scalar_function("sidebar_path", 1, flags, |ctx| {
        Ok(crate::flows::sidebar_path(&ctx.get::<String>(0)?))
    })?;
    conn.create_scalar_function("under_site", 2, flags, |ctx| {
        Ok(crate::flows::under_site(&ctx.get::<String>(0)?, &ctx.get::<String>(1)?))
    })?;
    conn.create_scalar_function("folder_name", 1, flags, |ctx| {
        let dir = ctx.get::<Option<String>>(0)?;
        Ok(crate::flows::folder_name(dir.as_deref()).map(str::to_string))
    })?;
    conn.create_scalar_function("is_system", 2, flags, |ctx| {
        let bundle_id = ctx.get::<Option<String>>(0)?;
        let path = ctx.get::<Option<String>>(1)?;
        Ok(crate::flows::is_system(bundle_id.as_deref(), path.as_deref()))
    })
}

fn read_only_pool(path: &Path) -> Result<SqlitePool> {
    let manager = SqliteConnectionManager::file(path)
        .with_flags(OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .with_init(|conn| {
            conn.busy_timeout(Duration::from_millis(5000))?;
            add_functions(conn)
        });
    Pool::builder()
        .max_size(2)
        .connection_timeout(Duration::from_secs(10))
        .build(manager)
        .map_err(|e| Error::Database(e.to_string()))
}

fn file_pool(path: &Path, max_size: u32) -> Result<SqlitePool> {
    let manager = SqliteConnectionManager::file(path).with_init(|conn| {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(Duration::from_millis(5000))?;
        add_functions(conn)
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
    fn reads_flows_read_only_before_migrations() {
        use crate::models::Flow;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("proxy.db");
        drop(ProxyQueryManager::new(&path).unwrap());

        // As a build from before the saved request and client columns left it.
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "ALTER TABLE flows DROP COLUMN saved_request_id;
            ALTER TABLE flows DROP COLUMN client_pid;
            ALTER TABLE flows DROP COLUMN client_name;
            ALTER TABLE flows DROP COLUMN client_bundle_id;
            ALTER TABLE flows DROP COLUMN client_path;
            ALTER TABLE flows DROP COLUMN cancelled;
            ALTER TABLE flows DROP COLUMN stream_kind;
            ALTER TABLE flows DROP COLUMN message_count;
            ALTER TABLE flows DROP COLUMN grpc_service;
            ALTER TABLE flows DROP COLUMN grpc_method;
            ALTER TABLE flows DROP COLUMN grpc_status;
            ALTER TABLE flows DROP COLUMN grpc_message;
            INSERT INTO flows (id, url, method) VALUES ('fl_old', 'https://example.com', 'GET');",
        )
        .unwrap();
        drop(conn);

        let db = ProxyQueryManager::open_read_only(&path).unwrap();
        let flows = db.with_conn(|c| c.find_all::<Flow>()).unwrap();
        assert_eq!(flows.len(), 1);
        assert_eq!((flows[0].id.as_str(), flows[0].saved_request_id.as_deref()), ("fl_old", None));
        assert_eq!((flows[0].client_pid, flows[0].client_name.as_deref()), (None, None));
        assert!(!flows[0].cancelled);
        assert_eq!((flows[0].stream_kind, flows[0].message_count), (None, 0));
        // Failed flows are found without the gRPC status column too.
        let failed =
            crate::flows::FlowFilter { status: Some("error".into()), ..Default::default() };
        assert_eq!(crate::flows::list(&db, &failed).unwrap().len(), 0);

        // Filters by app work without the folder column, and count without the clear mark.
        drop(db);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "ALTER TABLE flows ADD COLUMN client_name TEXT;
            ALTER TABLE flows ADD COLUMN client_bundle_id TEXT;
            ALTER TABLE flows ADD COLUMN client_path TEXT;
            ALTER TABLE flows DROP COLUMN client_cwd;
            DROP TABLE flow_clear_mark;
            UPDATE flows SET client_name = 'curl', client_path = '/usr/bin/curl';",
        )
        .unwrap();
        drop(conn);
        let db = ProxyQueryManager::open_read_only(&path).unwrap();
        let filter =
            crate::flows::FlowFilter { app: Some(vec!["curl".into()]), ..Default::default() };
        let (page, total, matching) = crate::flows::page(&db, &filter).unwrap();
        assert_eq!((page.len(), total, matching), (1, 1, Some(1)));
        assert_eq!(page[0].number, 1);
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
        assert_eq!(
            tables,
            vec![
                "_sqlx_migrations",
                "flow_clear_mark",
                "flow_messages",
                "flows",
                "grpc_schemas"
            ]
        );

        let flow_columns = columns(&conn, "flows");
        assert!(flow_columns.contains(&"response_truncated".to_string()));
        for column in [
            "client_pid",
            "client_name",
            "client_bundle_id",
            "client_path",
            "client_cwd",
            "cancelled",
            "stream_kind",
            "message_count",
            "grpc_service",
            "grpc_method",
            "grpc_status",
            "grpc_message",
        ] {
            assert!(flow_columns.contains(&column.to_string()), "{column} in {flow_columns:?}");
        }
        let indexes: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'flows' AND sql IS NOT NULL")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|i| i.unwrap())
            .collect();
        assert_eq!(indexes, vec!["idx_flows_started_at_id"]);
        assert!(!flow_columns.iter().any(|c| c.contains("body")), "{flow_columns:?}");

        let journal_mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
        assert_eq!(journal_mode, "wal");
    }

    #[test]
    fn takes_the_folder_and_clear_mark_after_the_messages_migration() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("proxy.db");

        // As a build with every migration up to the messages one left it, with a stream in it.
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE _sqlx_migrations (
                version TEXT PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
            );",
        )
        .unwrap();
        let mut files: Vec<_> = MIGRATIONS
            .files()
            .map(|f| (f.path().to_string_lossy().into_owned(), f.contents_utf8().unwrap()))
            .filter(|(name, _)| name.as_str() < "00000007")
            .collect();
        files.sort();
        assert_eq!(files.len(), 6);
        for (name, sql) in files {
            conn.execute_batch(sql).unwrap();
            conn.execute(
                "INSERT INTO _sqlx_migrations (version, description) VALUES (?, ?)",
                [&name[..8], &name],
            )
            .unwrap();
        }
        conn.execute_batch(
            "INSERT INTO flows (id, url, method, stream_kind, message_count, client_path)
                VALUES ('fl_ws', 'wss://example.com/socket', 'GET', 'websocket', 2, '/bin/node');
            INSERT INTO flow_messages (id, flow_id, seq, direction, kind, timestamp)
                VALUES ('fm_1', 'fl_ws', 1, 'client', 'text', CURRENT_TIMESTAMP);",
        )
        .unwrap();
        drop(conn);

        drop(ProxyQueryManager::new(&path).unwrap());

        let conn = Connection::open(&path).unwrap();
        assert!(columns(&conn, "flows").contains(&"client_cwd".to_string()));
        let applied: Vec<String> = conn
            .prepare("SELECT version FROM _sqlx_migrations ORDER BY version")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|v| v.unwrap())
            .collect();
        assert_eq!(&applied[applied.len() - 2..], ["00000007", "00000008"]);
        let mark_columns = columns(&conn, "flow_clear_mark");
        assert_eq!(mark_columns, ["id", "max_rowid", "cleaner", "cleaner_at"]);
        drop(conn);

        // The stream and its messages come through, and clearing then deleting takes both.
        let db = ProxyQueryManager::new(&path).unwrap();
        let blobs = yaak_models::init_blob_store(dir.path().join("blobs.sqlite")).unwrap();
        let listed = crate::flows::list(&db, &Default::default()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!((listed[0].id.as_str(), listed[0].message_count), ("fl_ws", 2));
        assert_eq!(crate::messages::count(&db, "fl_ws").unwrap(), 1);
        assert_eq!(crate::flows::clear(&db).unwrap(), 1);
        assert_eq!(
            crate::flows::delete_cleared(&db, &blobs, 500, "cln_test"),
            Ok(crate::flows::Cleaned::Done)
        );
        assert_eq!(crate::messages::count(&db, "fl_ws").unwrap(), 0);
    }
}
