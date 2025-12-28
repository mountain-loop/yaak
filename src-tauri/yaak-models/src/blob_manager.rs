use crate::error::Result;
use crate::util::generate_prefixed_id;
use include_dir::{Dir, include_dir};
use log::{debug, info};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{OptionalExtension, params};
use std::sync::{Arc, Mutex};
use tauri::{Manager, Runtime, State};

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

/// Extension trait for accessing the blob manager from app handle.
pub trait BlobManagerExt<'a, R> {
    fn blob_manager(&'a self) -> State<'a, BlobManager>;
    fn blobs(&'a self) -> BlobContext;
}

impl<'a, R: Runtime, M: Manager<R>> BlobManagerExt<'a, R> for M {
    fn blob_manager(&'a self) -> State<'a, BlobManager> {
        self.state::<BlobManager>()
    }

    fn blobs(&'a self) -> BlobContext {
        let manager = self.state::<BlobManager>();
        manager.inner().connect()
    }
}

/// Manages the blob database connection pool.
#[derive(Debug, Clone)]
pub struct BlobManager {
    pool: Arc<Mutex<Pool<SqliteConnectionManager>>>,
}

impl BlobManager {
    pub fn new(pool: Pool<SqliteConnectionManager>) -> Self {
        Self { pool: Arc::new(Mutex::new(pool)) }
    }

    pub fn connect(&self) -> BlobContext {
        let conn = self
            .pool
            .lock()
            .expect("Failed to gain lock on blob DB")
            .get()
            .expect("Failed to get blob DB connection from pool");
        BlobContext { conn }
    }
}

/// Context for blob database operations.
pub struct BlobContext {
    conn: r2d2::PooledConnection<SqliteConnectionManager>,
}

impl BlobContext {
    /// Insert a single chunk.
    pub fn insert_chunk(&self, chunk: &BodyChunk) -> Result<()> {
        self.conn.execute(
            "INSERT INTO body_chunks (id, body_id, chunk_index, data) VALUES (?1, ?2, ?3, ?4)",
            params![chunk.id, chunk.body_id, chunk.chunk_index, chunk.data],
        )?;
        Ok(())
    }

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

    /// Delete all chunks for a body.
    pub fn delete_chunks(&self, body_id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM body_chunks WHERE body_id = ?1", params![body_id])?;
        Ok(())
    }

    /// Delete all chunks matching a body_id prefix (e.g., "rs_abc123.%" to delete all bodies for a response).
    pub fn delete_chunks_like(&self, body_id_prefix: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM body_chunks WHERE body_id LIKE ?1", params![body_id_prefix])?;
        Ok(())
    }
}

/// Get total size of a body without loading data.
impl BlobContext {
    pub fn get_body_size(&self, body_id: &str) -> Result<usize> {
        let size: i64 = self
            .conn
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
            .query_row(
                "SELECT COUNT(*) FROM body_chunks WHERE body_id = ?1",
                params![body_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok(count > 0)
    }
}

/// Run migrations for the blob database.
pub fn migrate_blob_db(pool: &Pool<SqliteConnectionManager>) -> Result<()> {
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

    fn create_test_pool() -> Pool<SqliteConnectionManager> {
        let manager = SqliteConnectionManager::memory();
        let pool = Pool::builder().max_size(1).build(manager).unwrap();
        migrate_blob_db(&pool).unwrap();
        pool
    }

    #[test]
    fn test_insert_and_get_chunks() {
        let pool = create_test_pool();
        let manager = BlobManager::new(pool);
        let ctx = manager.connect();

        let body_id = "rs_test123.request";
        let chunk1 = BodyChunk::new(body_id, 0, b"Hello, ".to_vec());
        let chunk2 = BodyChunk::new(body_id, 1, b"World!".to_vec());

        ctx.insert_chunk(&chunk1).unwrap();
        ctx.insert_chunk(&chunk2).unwrap();

        let chunks = ctx.get_chunks(body_id).unwrap();
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].chunk_index, 0);
        assert_eq!(chunks[0].data, b"Hello, ");
        assert_eq!(chunks[1].chunk_index, 1);
        assert_eq!(chunks[1].data, b"World!");
    }

    #[test]
    fn test_get_chunks_ordered_by_index() {
        let pool = create_test_pool();
        let manager = BlobManager::new(pool);
        let ctx = manager.connect();

        let body_id = "rs_test123.request";

        // Insert out of order
        ctx.insert_chunk(&BodyChunk::new(body_id, 2, b"C".to_vec())).unwrap();
        ctx.insert_chunk(&BodyChunk::new(body_id, 0, b"A".to_vec())).unwrap();
        ctx.insert_chunk(&BodyChunk::new(body_id, 1, b"B".to_vec())).unwrap();

        let chunks = ctx.get_chunks(body_id).unwrap();
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].data, b"A");
        assert_eq!(chunks[1].data, b"B");
        assert_eq!(chunks[2].data, b"C");
    }

    #[test]
    fn test_delete_chunks() {
        let pool = create_test_pool();
        let manager = BlobManager::new(pool);
        let ctx = manager.connect();

        let body_id = "rs_test123.request";
        ctx.insert_chunk(&BodyChunk::new(body_id, 0, b"data".to_vec())).unwrap();

        assert!(ctx.body_exists(body_id).unwrap());

        ctx.delete_chunks(body_id).unwrap();

        assert!(!ctx.body_exists(body_id).unwrap());
        assert_eq!(ctx.get_chunks(body_id).unwrap().len(), 0);
    }

    #[test]
    fn test_delete_chunks_like() {
        let pool = create_test_pool();
        let manager = BlobManager::new(pool);
        let ctx = manager.connect();

        // Insert chunks for same response but different body types
        ctx.insert_chunk(&BodyChunk::new("rs_abc.request", 0, b"req".to_vec())).unwrap();
        ctx.insert_chunk(&BodyChunk::new("rs_abc.response", 0, b"resp".to_vec())).unwrap();
        ctx.insert_chunk(&BodyChunk::new("rs_other.request", 0, b"other".to_vec())).unwrap();

        // Delete all bodies for rs_abc
        ctx.delete_chunks_like("rs_abc.%").unwrap();

        // rs_abc bodies should be gone
        assert!(!ctx.body_exists("rs_abc.request").unwrap());
        assert!(!ctx.body_exists("rs_abc.response").unwrap());

        // rs_other should still exist
        assert!(ctx.body_exists("rs_other.request").unwrap());
    }

    #[test]
    fn test_get_body_size() {
        let pool = create_test_pool();
        let manager = BlobManager::new(pool);
        let ctx = manager.connect();

        let body_id = "rs_test123.request";
        ctx.insert_chunk(&BodyChunk::new(body_id, 0, b"Hello".to_vec())).unwrap();
        ctx.insert_chunk(&BodyChunk::new(body_id, 1, b"World".to_vec())).unwrap();

        let size = ctx.get_body_size(body_id).unwrap();
        assert_eq!(size, 10); // "Hello" + "World" = 10 bytes
    }

    #[test]
    fn test_get_body_size_empty() {
        let pool = create_test_pool();
        let manager = BlobManager::new(pool);
        let ctx = manager.connect();

        let size = ctx.get_body_size("nonexistent").unwrap();
        assert_eq!(size, 0);
    }

    #[test]
    fn test_body_exists() {
        let pool = create_test_pool();
        let manager = BlobManager::new(pool);
        let ctx = manager.connect();

        assert!(!ctx.body_exists("rs_test.request").unwrap());

        ctx.insert_chunk(&BodyChunk::new("rs_test.request", 0, b"data".to_vec())).unwrap();

        assert!(ctx.body_exists("rs_test.request").unwrap());
    }

    #[test]
    fn test_multiple_bodies_isolated() {
        let pool = create_test_pool();
        let manager = BlobManager::new(pool);
        let ctx = manager.connect();

        ctx.insert_chunk(&BodyChunk::new("body1", 0, b"data1".to_vec())).unwrap();
        ctx.insert_chunk(&BodyChunk::new("body2", 0, b"data2".to_vec())).unwrap();

        let chunks1 = ctx.get_chunks("body1").unwrap();
        let chunks2 = ctx.get_chunks("body2").unwrap();

        assert_eq!(chunks1.len(), 1);
        assert_eq!(chunks1[0].data, b"data1");
        assert_eq!(chunks2.len(), 1);
        assert_eq!(chunks2[0].data, b"data2");
    }

    #[test]
    fn test_large_chunk() {
        let pool = create_test_pool();
        let manager = BlobManager::new(pool);
        let ctx = manager.connect();

        // 1MB chunk
        let large_data: Vec<u8> = (0..1024 * 1024).map(|i| (i % 256) as u8).collect();
        let body_id = "rs_large.request";

        ctx.insert_chunk(&BodyChunk::new(body_id, 0, large_data.clone())).unwrap();

        let chunks = ctx.get_chunks(body_id).unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].data, large_data);
        assert_eq!(ctx.get_body_size(body_id).unwrap(), 1024 * 1024);
    }
}
