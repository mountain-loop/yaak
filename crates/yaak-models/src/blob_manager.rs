use crate::error::Error::GenericError;
use crate::error::Result;
use crate::util::generate_prefixed_id;
use include_dir::{Dir, include_dir};
use log::{debug, info};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use std::ops::Deref;
use yaak_database::{ConnectionOrTx, SqlitePool};

static BLOB_MIGRATIONS_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/blob_migrations");

/// A chunk of body data stored in the blob database.
#[derive(Debug, Clone)]
pub struct BodyChunk {
    pub id: String,
    pub body_id: String,
    pub chunk_index: i32,
    pub data: Vec<u8>,
}

impl BodyChunk {
    pub fn new(body_id: impl Into<String>, chunk_index: i32, data: Vec<u8>) -> Self {
        Self { id: generate_prefixed_id("bc"), body_id: body_id.into(), chunk_index, data }
    }
}

/// Manages the blob database: a reader pool and a single writer, for the
/// same reason as [`crate::query_manager::QueryManager`].
// Pools are internally synchronized — don't wrap them in a Mutex. A Mutex held across the
// blocking `get()` serializes every blob access behind the slowest waiter, freezing the
// whole app whenever the pool is exhausted.
#[derive(Debug, Clone)]
pub struct BlobManager {
    readers: SqlitePool,
    writer: SqlitePool,
}

impl BlobManager {
    /// `writer` must be a pool with a single connection.
    pub fn new(readers: SqlitePool, writer: SqlitePool) -> Self {
        Self { readers, writer }
    }

    /// A read handle from the reader pool.
    pub fn connect(&self) -> BlobContext<'_> {
        let conn = self.readers.get().expect("Failed to get blob DB connection from pool");
        BlobContext { conn: ConnectionOrTx::Connection(conn) }
    }

    /// Run `func` in a transaction on the writer connection.
    pub fn with_tx<T, E>(
        &self,
        func: impl FnOnce(&BlobWriter) -> std::result::Result<T, E>,
    ) -> std::result::Result<T, E>
    where
        E: From<crate::error::Error>,
    {
        let conn = self.writer.get().map_err(crate::error::Error::SqlPoolError)?;
        let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate)
            .map_err(crate::error::Error::SqlError)?;
        let writer = BlobWriter { ctx: BlobContext { conn: ConnectionOrTx::Transaction(&tx) } };
        match func(&writer) {
            Ok(val) => {
                tx.commit().map_err(|e| {
                    GenericError(format!("Failed to commit blob transaction {e:?}"))
                })?;
                Ok(val)
            }
            Err(e) => {
                tx.rollback().map_err(|e| {
                    GenericError(format!("Failed to rollback blob transaction {e:?}"))
                })?;
                Err(e)
            }
        }
    }
}

/// Read handle for the blob database.
pub struct BlobContext<'a> {
    conn: ConnectionOrTx<'a>,
}

impl<'a> BlobContext<'a> {
    /// Get all chunks for a body, ordered by chunk_index.
    pub fn get_chunks(&self, body_id: &str) -> Result<Vec<BodyChunk>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, body_id, chunk_index, data FROM body_chunks
             WHERE body_id = ?1 ORDER BY chunk_index ASC",
        )?;

        let chunks = stmt
            .query_map(params![body_id], |row| {
                Ok(BodyChunk {
                    id: row.get(0)?,
                    body_id: row.get(1)?,
                    chunk_index: row.get(2)?,
                    data: row.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(chunks)
    }

    /// List all distinct body IDs in the blob database.
    pub fn list_body_ids(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT DISTINCT body_id FROM body_chunks")?;
        let ids = stmt
            .query_map([], |row| row.get(0))?
            .collect::<std::result::Result<Vec<String>, _>>()?;
        Ok(ids)
    }

    /// Get total size of a body without loading data.
    pub fn get_body_size(&self, body_id: &str) -> Result<usize> {
        let size: i64 = self
            .conn
            .resolve()
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM body_chunks WHERE body_id = ?1",
                params![body_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok(size as usize)
    }

    /// Check if a body exists.
    pub fn body_exists(&self, body_id: &str) -> Result<bool> {
        let count: i64 = self
            .conn
            .resolve()
            .query_row(
                "SELECT COUNT(*) FROM body_chunks WHERE body_id = ?1",
                params![body_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok(count > 0)
    }
}

/// Write handle for the blob database. Derefs to [`BlobContext`] for reads.
pub struct BlobWriter<'a> {
    ctx: BlobContext<'a>,
}

impl<'a> Deref for BlobWriter<'a> {
    type Target = BlobContext<'a>;

    fn deref(&self) -> &BlobContext<'a> {
        &self.ctx
    }
}

impl<'a> BlobWriter<'a> {
    /// Insert a single chunk.
    pub fn insert_chunk(&self, chunk: &BodyChunk) -> Result<()> {
        self.conn.execute(
            "INSERT INTO body_chunks (id, body_id, chunk_index, data) VALUES (?1, ?2, ?3, ?4)",
            params![chunk.id, chunk.body_id, chunk.chunk_index, chunk.data],
        )?;
        Ok(())
    }

    /// Delete all chunks for a body.
    pub fn delete_chunks(&self, body_id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM body_chunks WHERE body_id = ?1", params![body_id])?;
        Ok(())
    }

    /// Delete all chunks matching a body_id prefix (e.g., "rs_abc123.%" to delete all
    /// bodies for a response).
    pub fn delete_chunks_like(&self, body_id_prefix: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM body_chunks WHERE body_id LIKE ?1", params![body_id_prefix])?;
        Ok(())
    }
}

/// Run migrations for the blob database.
pub fn migrate_blob_db(pool: &SqlitePool) -> Result<()> {
    info!("Running blob database migrations");

    // Create migrations tracking table
    pool.get()?.execute(
        "CREATE TABLE IF NOT EXISTS _blob_migrations (
            version     TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
        )",
        [],
    )?;

    // Read and sort all .sql files
    let mut entries: Vec<_> = BLOB_MIGRATIONS_DIR
        .entries()
        .iter()
        .filter(|e| e.path().extension().map(|ext| ext == "sql").unwrap_or(false))
        .collect();

    entries.sort_by_key(|e| e.path());

    let mut ran_migrations = 0;
    for entry in &entries {
        let filename = entry.path().file_name().unwrap().to_str().unwrap();
        let version = filename.split('_').next().unwrap();

        // Check if already applied
        let already_applied: Option<i64> = pool
            .get()?
            .query_row("SELECT 1 FROM _blob_migrations WHERE version = ?", [version], |r| r.get(0))
            .optional()?;

        if already_applied.is_some() {
            debug!("Skipping already applied blob migration: {}", filename);
            continue;
        }

        let sql =
            entry.as_file().unwrap().contents_utf8().expect("Failed to read blob migration file");

        info!("Applying blob migration: {}", filename);
        let conn = pool.get()?;
        conn.execute_batch(sql)?;

        // Record migration
        conn.execute(
            "INSERT INTO _blob_migrations (version, description) VALUES (?, ?)",
            params![version, filename],
        )?;

        ran_migrations += 1;
    }

    if ran_migrations == 0 {
        info!("No blob migrations to run");
    } else {
        info!("Ran {} blob migration(s)", ran_migrations);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;

    fn create_test_manager() -> BlobManager {
        let manager = r2d2_sqlite::SqliteConnectionManager::memory();
        let pool = r2d2::Pool::builder().max_size(1).build(manager).unwrap();
        migrate_blob_db(&pool).unwrap();
        BlobManager::new(pool.clone(), pool)
    }

    fn insert(manager: &BlobManager, chunks: &[BodyChunk]) {
        manager
            .with_tx(|b| {
                for c in chunks {
                    b.insert_chunk(c)?;
                }
                Ok::<_, Error>(())
            })
            .unwrap();
    }

    #[test]
    fn test_insert_and_get_chunks() {
        let manager = create_test_manager();
        let body_id = "rs_test123.request";
        insert(
            &manager,
            &[
                BodyChunk::new(body_id, 0, b"Hello, ".to_vec()),
                BodyChunk::new(body_id, 1, b"World!".to_vec()),
            ],
        );

        let chunks = manager.connect().get_chunks(body_id).unwrap();
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].chunk_index, 0);
        assert_eq!(chunks[0].data, b"Hello, ");
        assert_eq!(chunks[1].chunk_index, 1);
        assert_eq!(chunks[1].data, b"World!");
    }

    #[test]
    fn test_get_chunks_ordered_by_index() {
        let manager = create_test_manager();
        let body_id = "rs_test123.request";
        // Insert out of order
        insert(
            &manager,
            &[
                BodyChunk::new(body_id, 2, b"C".to_vec()),
                BodyChunk::new(body_id, 0, b"A".to_vec()),
                BodyChunk::new(body_id, 1, b"B".to_vec()),
            ],
        );

        let chunks = manager.connect().get_chunks(body_id).unwrap();
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].data, b"A");
        assert_eq!(chunks[1].data, b"B");
        assert_eq!(chunks[2].data, b"C");
    }

    #[test]
    fn test_delete_chunks() {
        let manager = create_test_manager();
        let body_id = "rs_test123.request";
        insert(&manager, &[BodyChunk::new(body_id, 0, b"data".to_vec())]);
        assert!(manager.connect().body_exists(body_id).unwrap());

        manager.with_tx(|b| b.delete_chunks(body_id)).unwrap();

        let ctx = manager.connect();
        assert!(!ctx.body_exists(body_id).unwrap());
        assert_eq!(ctx.get_chunks(body_id).unwrap().len(), 0);
    }

    #[test]
    fn test_delete_chunks_like() {
        let manager = create_test_manager();
        // Insert chunks for same response but different body types
        insert(
            &manager,
            &[
                BodyChunk::new("rs_abc.request", 0, b"req".to_vec()),
                BodyChunk::new("rs_abc.response", 0, b"resp".to_vec()),
                BodyChunk::new("rs_other.request", 0, b"other".to_vec()),
            ],
        );

        // Delete all bodies for rs_abc
        manager.with_tx(|b| b.delete_chunks_like("rs_abc.%")).unwrap();

        let ctx = manager.connect();
        assert!(!ctx.body_exists("rs_abc.request").unwrap());
        assert!(!ctx.body_exists("rs_abc.response").unwrap());
        assert!(ctx.body_exists("rs_other.request").unwrap());
    }

    #[test]
    fn test_get_body_size() {
        let manager = create_test_manager();
        let body_id = "rs_test123.request";
        insert(
            &manager,
            &[
                BodyChunk::new(body_id, 0, b"Hello".to_vec()),
                BodyChunk::new(body_id, 1, b"World".to_vec()),
            ],
        );

        let size = manager.connect().get_body_size(body_id).unwrap();
        assert_eq!(size, 10); // "Hello" + "World" = 10 bytes
    }

    #[test]
    fn test_get_body_size_empty() {
        let manager = create_test_manager();
        let size = manager.connect().get_body_size("nonexistent").unwrap();
        assert_eq!(size, 0);
    }

    #[test]
    fn test_body_exists() {
        let manager = create_test_manager();
        assert!(!manager.connect().body_exists("rs_test.request").unwrap());

        insert(&manager, &[BodyChunk::new("rs_test.request", 0, b"data".to_vec())]);

        assert!(manager.connect().body_exists("rs_test.request").unwrap());
    }

    #[test]
    fn test_multiple_bodies_isolated() {
        let manager = create_test_manager();
        insert(
            &manager,
            &[
                BodyChunk::new("body1", 0, b"data1".to_vec()),
                BodyChunk::new("body2", 0, b"data2".to_vec()),
            ],
        );

        let ctx = manager.connect();
        let chunks1 = ctx.get_chunks("body1").unwrap();
        let chunks2 = ctx.get_chunks("body2").unwrap();

        assert_eq!(chunks1.len(), 1);
        assert_eq!(chunks1[0].data, b"data1");
        assert_eq!(chunks2.len(), 1);
        assert_eq!(chunks2[0].data, b"data2");
    }

    #[test]
    fn test_large_chunk() {
        let manager = create_test_manager();
        // 1MB chunk
        let large_data: Vec<u8> = (0..1024 * 1024).map(|i| (i % 256) as u8).collect();
        let body_id = "rs_large.request";
        insert(&manager, &[BodyChunk::new(body_id, 0, large_data.clone())]);

        let ctx = manager.connect();
        let chunks = ctx.get_chunks(body_id).unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].data, large_data);
        assert_eq!(ctx.get_body_size(body_id).unwrap(), 1024 * 1024);
    }
}
