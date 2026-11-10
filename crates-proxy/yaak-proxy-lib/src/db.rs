//! The one place the proxy's databases are opened. `proxy.db` and `blobs.sqlite` are encrypted
//! whole with SQLCipher, keyed from the data key [`Stores::open`] is given: every connection is
//! keyed as it opens, and a plain database left by a build from before is converted before
//! anything writes to it. Only reading, an unconverted one is read as it is.

use include_dir::{Dir, include_dir};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::functions::FunctionFlags;
use rusqlite::{OpenFlags, Transaction, TransactionBehavior};
use std::path::{Path, PathBuf};
use std::time::Duration;
use yaak_crypto::MasterKeySource;
use yaak_crypto::data_key::DataKey;
use yaak_database::encryption::{self, DatabaseKey, FileState};
use yaak_database::{ConnectionOrTx, DbContext, Error, Result, SqlitePool, run_migrations};
use yaak_models::blob_manager::BlobManager;

static MIGRATIONS: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/migrations");

/// Flows, their headers and messages.
pub const PROXY_DB: &str = "proxy.db";
/// Request and response bodies, and message payloads.
pub const BLOBS_DB: &str = "blobs.sqlite";
/// The key both are encrypted with, wrapped by the app's master key in the keychain.
pub const DATA_KEY: &str = "data.key";

/// A pre-release build added `flows.tunnelled` in migration 8. A database it made has the
/// column without migration 9 recorded, which would fail adding it again, so it is recorded
/// as applied first.
fn record_early_tunnelled_column(pool: &SqlitePool) -> Result<()> {
    let conn = pool.get()?;
    let has_column = conn.prepare("SELECT tunnelled FROM flows LIMIT 0").is_ok();
    let has_tracking = conn.prepare("SELECT version FROM _sqlx_migrations LIMIT 0").is_ok();
    if has_column && has_tracking {
        conn.execute(
            "INSERT OR IGNORE INTO _sqlx_migrations (version, description) \
            VALUES ('00000009', '00000009_flow_tunnelled.sql')",
            [],
        )?;
    }
    Ok(())
}

/// Reads come from a pool; writes go through one connection, as in yaak-models'
/// `QueryManager`. WAL lets the CLI read `proxy.db` while the app writes it.
#[derive(Clone)]
pub struct ProxyQueryManager {
    readers: SqlitePool,
    writer: SqlitePool,
}

impl ProxyQueryManager {
    /// Opens `proxy.db` encrypted with `key`, made so when it is new and converted when a build
    /// from before left it plain, and brings its schema up to date.
    pub fn new(db_path: &Path, key: &DatabaseKey) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        encryption::encrypt_in_place(db_path, key, &|_| {})?;
        let writer = file_pool(db_path, 1, key)?;
        record_early_tunnelled_column(&writer)?;
        run_migrations(&writer, &MIGRATIONS)?;
        Ok(Self { readers: file_pool(db_path, 5, key)?, writer })
    }

    /// `proxy.db` for reading while another process may be writing it, or none is. Writes
    /// fail. No migrations run, so an older database reads as it is. An encrypted one needs
    /// `key`; a plain one, not yet converted, is read without it.
    pub fn open_read_only(db_path: &Path, key: Option<&DatabaseKey>) -> Result<Self> {
        let readers = read_only_pool(db_path, key)?;
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

/// `blobs.sqlite` encrypted with `key`, converted first when it is plain, migrated.
pub fn open_blobs(path: &Path, key: &DatabaseKey) -> Result<BlobManager> {
    encryption::encrypt_in_place(path, key, &|_| {})?;
    yaak_models::init_encrypted_blob_store(path, key).map_err(|e| Error::Database(e.to_string()))
}

/// `blobs.sqlite` for reading, alongside [`ProxyQueryManager::open_read_only`].
pub fn open_blobs_read_only(path: &Path, key: Option<&DatabaseKey>) -> Result<BlobManager> {
    let readers = read_only_pool(path, key)?;
    Ok(BlobManager::new(readers.clone(), readers))
}

/// The SQLCipher key for the databases, from the data key.
pub fn database_key(data_key: &DataKey) -> DatabaseKey {
    DatabaseKey::from_bytes(data_key.raw_bytes())
}

/// Where the data key is kept in `data_dir`.
pub fn data_key_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DATA_KEY)
}

/// The data key for the databases in `data_dir`, unwrapped with the master key in `keys`, and
/// made the first time. Not made again once a database is encrypted, should its file go: a new
/// one could not open it, and would replace the CA.
pub fn load_or_create_data_key(
    keys: &MasterKeySource,
    data_dir: &Path,
) -> std::result::Result<DataKey, String> {
    let path = data_key_path(data_dir);
    if any_encrypted(data_dir) {
        DataKey::load_file(keys, &path)
            .map_err(|e| key_unavailable(&e.to_string()))?
            .ok_or_else(|| missing_data_key(data_dir))
    } else {
        DataKey::load_or_create_file(keys, &path).map_err(|e| key_unavailable(&e.to_string()))
    }
}

fn any_encrypted(data_dir: &Path) -> bool {
    [PROXY_DB, BLOBS_DB]
        .iter()
        .any(|name| encryption::file_state(&data_dir.join(name)).ok() == Some(FileState::Encrypted))
}

fn missing_data_key(data_dir: &Path) -> String {
    format!(
        "The proxy's captured traffic is encrypted, but its key is missing from {}",
        data_dir.display()
    )
}

/// Both databases, opened together.
#[derive(Clone)]
pub struct Stores {
    pub db: ProxyQueryManager,
    pub blobs: BlobManager,
    /// `blobs.sqlite` and its key, for measuring it: its pools are its manager's own.
    blobs_path: PathBuf,
    key: Option<DatabaseKey>,
}

impl Stores {
    /// The databases in `data_dir`, encrypted with `key`. Ones a build from before left plain
    /// are converted first, without progress; [`encrypt_existing`] shows it.
    pub fn open(data_dir: &Path, key: &DatabaseKey) -> std::result::Result<Self, String> {
        let db = ProxyQueryManager::new(&data_dir.join(PROXY_DB), key)
            .map_err(|e| format!("Failed to open proxy database: {e}"))?;
        let blobs_path = data_dir.join(BLOBS_DB);
        let blobs = open_blobs(&blobs_path, key)
            .map_err(|e| format!("Failed to open proxy blob store: {e}"))?;
        Ok(Self { db, blobs, blobs_path, key: Some(key.clone()) })
    }

    /// Bytes the captured traffic takes, as [`used_bytes`] counts them, in both databases.
    pub fn used_bytes(&self) -> std::result::Result<u64, String> {
        let fail = |e: rusqlite::Error| format!("Failed to measure captured traffic: {e}");
        let flows = self.db.with_conn(|c| used_bytes(c.conn().resolve())).map_err(fail)?;
        let conn = rusqlite::Connection::open_with_flags(
            &self.blobs_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(fail)?;
        if let Some(key) = &self.key {
            encryption::apply_key(&conn, key).map_err(fail)?;
        }
        conn.busy_timeout(Duration::from_millis(5000)).map_err(fail)?;
        Ok(flows + used_bytes(&conn).map_err(fail)?)
    }

    /// The databases in `data_dir` for reading, with the data key the master key in `keys`
    /// unwraps. Asks the keychain only when one is encrypted, and never makes a key.
    pub fn open_read_only(
        data_dir: &Path,
        keys: &MasterKeySource,
    ) -> std::result::Result<Self, String> {
        let db_path = data_dir.join(PROXY_DB);
        let blobs_path = data_dir.join(BLOBS_DB);
        let key = if any_encrypted(data_dir) {
            let data_key = DataKey::load_file(keys, &data_key_path(data_dir))
                .map_err(|e| key_unavailable(&e.to_string()))?
                .ok_or_else(|| missing_data_key(data_dir))?;
            Some(database_key(&data_key))
        } else {
            None
        };
        let db = ProxyQueryManager::open_read_only(&db_path, key.as_ref())
            .map_err(|e| format!("Failed to open {}: {e}", db_path.display()))?;
        let blobs = open_blobs_read_only(&blobs_path, key.as_ref())
            .map_err(|e| format!("Failed to open the proxy's blob store: {e}"))?;
        Ok(Self { db, blobs, blobs_path, key })
    }
}

/// Bytes the data in a database takes: its pages less the free ones. SQLite reuses free pages
/// but gives none back to the file without a vacuum, so this shrinks as rows are deleted where
/// the file does not. The WAL is left out, as its pages are copies of ones counted here.
pub fn used_bytes(conn: &rusqlite::Connection) -> rusqlite::Result<u64> {
    use rusqlite::types::Value;
    // SQLCipher answers `page_size` with its own as text.
    let pragma = |name: &str| {
        let value = conn.query_row(&format!("PRAGMA {name}"), [], |r| r.get::<_, Value>(0))?;
        let n = match &value {
            Value::Integer(n) => Some(*n),
            Value::Text(s) => s.trim().parse().ok(),
            _ => None,
        };
        n.ok_or_else(|| rusqlite::Error::InvalidColumnType(0, name.into(), value.data_type()))
    };
    let used = (pragma("page_count")? - pragma("freelist_count")?) * pragma("page_size")?;
    Ok(used.max(0) as u64)
}

/// The databases' files and what goes with them: their WAL and shared memory.
fn database_files(data_dir: &Path) -> impl Iterator<Item = PathBuf> + '_ {
    [PROXY_DB, BLOBS_DB]
        .into_iter()
        .flat_map(|name| ["", "-wal", "-shm"].map(|suffix| format!("{name}{suffix}")))
        .map(move |name| data_dir.join(name))
}

/// Bytes the databases' files take on disk, free pages and WAL included, for when they are
/// locked and cannot be measured as [`Stores::used_bytes`] does.
pub fn file_bytes(data_dir: &Path) -> u64 {
    database_files(data_dir).filter_map(|p| std::fs::metadata(p).ok()).map(|m| m.len()).sum()
}

/// Deletes the databases and the data key that encrypts them, for good. Nothing may write to
/// them meanwhile.
pub fn remove_captured(data_dir: &Path) -> std::result::Result<(), String> {
    let key = data_key_path(data_dir);
    for path in database_files(data_dir).chain([key.with_extension("tmp"), key]) {
        match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err(format!("Failed to delete {}: {e}", path.display()));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Deletes `blobs.sqlite`, every body and message payload, for one made empty as it opens.
/// What an interrupted conversion to encryption left beside it goes too, or opening would
/// recover it, bodies and all. The data key stays, as `proxy.db` is still encrypted with it.
/// Nothing may have it open.
pub fn remove_blobs(data_dir: &Path) -> std::result::Result<(), String> {
    for suffix in ["", "-wal", "-shm", "-plain", "-encrypting"] {
        let path = data_dir.join(format!("{BLOBS_DB}{suffix}"));
        match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err(format!("Failed to delete {}: {e}", path.display()));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Either database in `data_dir` is plain, left by a build from before encryption.
pub fn needs_encrypting(data_dir: &Path) -> bool {
    [PROXY_DB, BLOBS_DB]
        .iter()
        .any(|name| encryption::file_state(&data_dir.join(name)).ok() == Some(FileState::Plain))
}

/// Converts the plain databases in `data_dir` to ones encrypted with `key`, telling `progress`
/// how far it has got, from 0 to 1. Returns whether there were any. Nothing may have them
/// open meanwhile.
pub fn encrypt_existing(
    data_dir: &Path,
    key: &DatabaseKey,
    progress: &(dyn Fn(f64) + Sync),
) -> std::result::Result<bool, String> {
    let paths: Vec<PathBuf> = [PROXY_DB, BLOBS_DB]
        .iter()
        .map(|name| data_dir.join(name))
        .filter(|p| encryption::file_state(p).ok() == Some(FileState::Plain))
        .collect();
    let total = paths.iter().map(|p| encryption::plain_size(p)).sum::<u64>().max(1) as f64;
    let mut before = 0u64;
    let mut converted = false;
    for path in &paths {
        let size = encryption::plain_size(path);
        let done = before;
        let file_progress = move |written: u64| {
            progress(((done + written.min(size)) as f64 / total).min(1.0));
        };
        converted |= encryption::encrypt_in_place(path, key, &file_progress)
            .map_err(|e| format!("Failed to encrypt {}: {e}", path.display()))?;
        before += size;
    }
    progress(1.0);
    Ok(converted)
}

const KEY_UNAVAILABLE: &str =
    "Yaak Proxy stores traffic encrypted and couldn't read its key from the keychain";

/// Why the databases cannot be opened, or the CA made, without the data key.
pub fn key_unavailable(reason: &str) -> String {
    format!("{KEY_UNAVAILABLE}: {reason}. Allow it access, then retry.")
}

/// `reason` is [`key_unavailable`]'s: the keychain would not give up the key.
pub fn is_key_unavailable(reason: &str) -> bool {
    reason.starts_with(KEY_UNAVAILABLE)
}

/// The functions searches use: `folder_name(dir)`, for naming a program by its folder;
/// `is_system(bundle_id, path)`, for macOS's own daemons; and those the query compiler reads
/// flows' values and tests them with ([`crate::query::add_functions`]).
fn add_functions(conn: &mut rusqlite::Connection) -> rusqlite::Result<()> {
    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
    conn.create_scalar_function("folder_name", 1, flags, |ctx| {
        let dir = ctx.get::<Option<String>>(0)?;
        Ok(crate::flows::folder_name(dir.as_deref()).map(str::to_string))
    })?;
    conn.create_scalar_function("is_system", 2, flags, |ctx| {
        let bundle_id = ctx.get::<Option<String>>(0)?;
        let path = ctx.get::<Option<String>>(1)?;
        Ok(crate::flows::is_system(bundle_id.as_deref(), path.as_deref()))
    })?;
    crate::query::add_functions(conn)
}

fn read_only_pool(path: &Path, key: Option<&DatabaseKey>) -> Result<SqlitePool> {
    encryption::init_crypto();
    let key = match (encryption::file_state(path)?, key) {
        (FileState::Plain, _) => None,
        (_, Some(key)) => Some(key.clone()),
        (_, None) => {
            return Err(Error::Database(format!(
                "{} is encrypted, with no key to read it",
                path.display()
            )));
        }
    };
    let manager = SqliteConnectionManager::file(path)
        .with_flags(OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .with_init(move |conn| {
            if let Some(key) = &key {
                encryption::apply_key(conn, key)?;
            }
            conn.busy_timeout(Duration::from_millis(5000))?;
            add_functions(conn)
        });
    Pool::builder()
        .max_size(2)
        .connection_timeout(Duration::from_secs(10))
        .build(manager)
        .map_err(|e| Error::Database(e.to_string()))
}

fn file_pool(path: &Path, max_size: u32, key: &DatabaseKey) -> Result<SqlitePool> {
    encryption::init_crypto();
    let key = key.clone();
    let manager = SqliteConnectionManager::file(path).with_init(move |conn| {
        encryption::apply_key(conn, &key)?;
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

/// The key unit tests encrypt their databases with.
#[cfg(test)]
pub(crate) fn test_key() -> DatabaseKey {
    DatabaseKey::from_bytes([7; 32])
}

/// A connection to a database encrypted with [`test_key`], for altering it as another build
/// would have.
#[cfg(test)]
pub(crate) fn test_conn(path: &Path) -> rusqlite::Connection {
    let conn = rusqlite::Connection::open(path).unwrap();
    encryption::apply_key(&conn, &test_key()).unwrap();
    conn
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
        drop(ProxyQueryManager::new(&path, &crate::db::test_key()).unwrap());

        // As a build from before the saved request and client columns left it.
        let conn = test_conn(&path);
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

        let db = ProxyQueryManager::open_read_only(&path, Some(&test_key())).unwrap();
        let flows = db.with_conn(|c| c.find_all::<Flow>()).unwrap();
        assert_eq!(flows.len(), 1);
        assert_eq!((flows[0].id.as_str(), flows[0].saved_request_id.as_deref()), ("fl_old", None));
        assert_eq!((flows[0].client_pid, flows[0].client_name.as_deref()), (None, None));
        assert!(!flows[0].cancelled);
        assert_eq!((flows[0].stream_kind, flows[0].message_count), (None, 0));
        // Failed flows are found without the gRPC status column too.
        let failed = crate::flows::FlowFilter::search("@is:error");
        assert_eq!(crate::flows::list(&db, &failed).unwrap().len(), 0);

        // Filters by app work without the folder column, and count without the clear mark.
        drop(db);
        let conn = test_conn(&path);
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
        let db = ProxyQueryManager::open_read_only(&path, Some(&test_key())).unwrap();
        let filter = crate::flows::FlowFilter::search("@app:curl");
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

        let db = ProxyQueryManager::new(&path, &crate::db::test_key()).unwrap();
        drop(db);

        let conn = test_conn(&path);
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
                "filter_history",
                "flow_clear_mark",
                "flow_messages",
                "flow_sweep_pending",
                "flows",
                "grpc_schemas",
                "last_filter",
                "saved_queries"
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
            "graphql_operation",
            "agent_read",
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

        drop(ProxyQueryManager::new(&path, &crate::db::test_key()).unwrap());

        let conn = test_conn(&path);
        assert!(columns(&conn, "flows").contains(&"client_cwd".to_string()));
        let applied: Vec<String> = conn
            .prepare("SELECT version FROM _sqlx_migrations ORDER BY version")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|v| v.unwrap())
            .collect();
        assert_eq!(
            &applied[6..],
            [
                "00000007", "00000008", "00000009", "00000010", "00000011", "00000012", "00000013",
                "00000014", "00000015"
            ]
        );
        let mark_columns = columns(&conn, "flow_clear_mark");
        assert_eq!(mark_columns, ["id", "max_rowid", "cleaner", "cleaner_at"]);
        drop(conn);

        // The stream and its messages come through, and clearing then deleting takes both.
        let db = ProxyQueryManager::new(&path, &crate::db::test_key()).unwrap();
        let blobs = crate::db::open_blobs(&dir.path().join("blobs.sqlite"), &crate::db::test_key())
            .unwrap();
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

    /// A database a pre-release build made, with `tunnelled` added by its migration 8, opens
    /// without adding the column twice.
    #[test]
    fn opens_a_database_whose_migration_8_added_tunnelled() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("proxy.db");
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
            .filter(|(name, _)| name.as_str() < "00000009")
            .collect();
        files.sort();
        for (name, sql) in files {
            conn.execute_batch(sql).unwrap();
            conn.execute(
                "INSERT INTO _sqlx_migrations (version, description) VALUES (?, ?)",
                [&name[..8], &name],
            )
            .unwrap();
        }
        conn.execute_batch(
            "ALTER TABLE flows ADD COLUMN tunnelled BOOLEAN NOT NULL DEFAULT FALSE;",
        )
        .unwrap();
        drop(conn);

        let db = ProxyQueryManager::new(&path, &crate::db::test_key()).unwrap();
        let tunnel = crate::models::Flow {
            id: "fl_tunnel".into(),
            url: "https://a.com".into(),
            tunnelled: true,
            ..Default::default()
        };
        db.with_tx(|c| c.upsert(&tunnel, &yaak_database::UpdateSource::Background).map(|_| ()))
            .unwrap();
        assert!(crate::flows::find(&db, "fl_tunnel").unwrap().tunnelled);
        drop(db);
        // And again, with everything recorded.
        drop(ProxyQueryManager::new(&path, &crate::db::test_key()).unwrap());
    }

    /// A database that ran every migration up to the clear cleaner's, as the build before
    /// tunnelled flows left it, takes the `tunnelled` column and stores tunnelled flows.
    #[test]
    fn adds_tunnelled_to_a_database_at_migration_8() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("proxy.db");
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
            .filter(|(name, _)| name.as_str() < "00000009")
            .collect();
        files.sort();
        assert_eq!(files.len(), 8);
        for (name, sql) in files {
            conn.execute_batch(sql).unwrap();
            conn.execute(
                "INSERT INTO _sqlx_migrations (version, description) VALUES (?, ?)",
                [&name[..8], &name],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO flows (id, url, method) VALUES ('fl_old', 'https://a.com/', 'GET')",
            [],
        )
        .unwrap();
        assert!(!columns(&conn, "flows").contains(&"tunnelled".to_string()));
        drop(conn);

        let db = ProxyQueryManager::new(&path, &crate::db::test_key()).unwrap();
        let tunnel = crate::models::Flow {
            id: "fl_tunnel".into(),
            method: "CONNECT".into(),
            url: "https://bank.example.com".into(),
            tunnelled: true,
            ..Default::default()
        };
        db.with_tx(|c| c.upsert(&tunnel, &yaak_database::UpdateSource::Background).map(|_| ()))
            .unwrap();
        let filter = crate::flows::FlowFilter::search("@is:tunnelled");
        let listed = crate::flows::list(&db, &filter).unwrap();
        assert_eq!(listed.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(), ["fl_tunnel"]);
        let old = crate::flows::find(&db, "fl_old").unwrap();
        assert!(!old.tunnelled);
    }

    /// Removing the blob store takes what an interrupted conversion left too, which opening
    /// would otherwise recover, and leaves `proxy.db` and the key.
    #[test]
    fn removing_the_blobs_takes_a_conversion_s_leftovers() {
        let dir = tempfile::tempdir().unwrap();
        let blobs = ["", "-wal", "-shm", "-plain", "-encrypting"].map(|s| format!("{BLOBS_DB}{s}"));
        let kept = [PROXY_DB, DATA_KEY];
        for name in blobs.iter().map(String::as_str).chain(kept) {
            std::fs::write(dir.path().join(name), b"x").unwrap();
        }
        remove_blobs(dir.path()).unwrap();
        assert!(blobs.iter().all(|name| !dir.path().join(name).exists()));
        assert!(kept.iter().all(|name| dir.path().join(name).exists()));
        // Nothing there is fine too.
        remove_blobs(dir.path()).unwrap();
    }
}
