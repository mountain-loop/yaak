//! Whole-database encryption with SQLCipher: the key a connection is opened with, and the
//! one-time conversion of a plain database into an encrypted one.
//!
//! An encrypted file is SQLite inside, so every query, index and full-text table works as on a
//! plain one; pages are encrypted as they are written and decrypted as they are read. Built only
//! with the `sqlcipher` feature, which links SQLCipher in place of SQLite: a build without it
//! cannot open an encrypted file, and one with it opens plain files without a key as before.

use crate::error::{Error, Result};
use rusqlite::Connection;
use std::fmt;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// A database's 256-bit key, given to SQLCipher raw: no passphrase, so no key derivation runs
/// as each connection opens. The file's salt stays in its first 16 bytes, as SQLCipher keeps it.
#[derive(Clone)]
pub struct DatabaseKey([u8; 32]);

impl DatabaseKey {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// The key as `PRAGMA key` and `ATTACH … KEY` take it raw: `"x'…'"`.
    fn sql_literal(&self) -> String {
        let hex: String = self.0.iter().map(|b| format!("{b:02X}")).collect();
        format!("\"x'{hex}'\"")
    }
}

/// Never prints the key.
impl fmt::Debug for DatabaseKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("DatabaseKey(..)")
    }
}

/// What is at a database's path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileState {
    /// Nothing, or an empty file: one opened with a key starts out encrypted.
    Missing,
    /// A plain SQLite database, which [`encrypt_in_place`] converts.
    Plain,
    /// Anything else, which only the right key opens.
    Encrypted,
}

const PLAIN_HEADER: &[u8; 16] = b"SQLite format 3\0";

/// Whether `path` holds a plain database, an encrypted one, or none. Reads the first 16 bytes:
/// a plain file starts with SQLite's header, an encrypted one with its random salt.
pub fn file_state(path: &Path) -> io::Result<FileState> {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(FileState::Missing),
        Err(e) => return Err(e),
    };
    let mut header = [0u8; 16];
    let mut read = 0;
    while read < header.len() {
        match file.read(&mut header[read..])? {
            0 => break,
            n => read += n,
        }
    }
    Ok(match read {
        0 => FileState::Missing,
        _ if &header == PLAIN_HEADER => FileState::Plain,
        _ => FileState::Encrypted,
    })
}

/// Keys `conn`, which must have just been opened and not yet read: every pool's connection
/// init calls this first. Reads the schema at once, so a wrong key, or a plain file, fails here
/// ("file is not a database") rather than at the first query.
pub fn apply_key(conn: &Connection, key: &DatabaseKey) -> rusqlite::Result<()> {
    conn.execute_batch(&format!("PRAGMA key = {};", key.sql_literal()))?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
}

/// The bytes a plain database at `path` takes, with its WAL: what [`encrypt_in_place`] has to
/// write, for showing its progress.
pub fn plain_size(path: &Path) -> u64 {
    [path.to_path_buf(), sidecar(path, "-wal")]
        .iter()
        .filter_map(|p| fs::metadata(p).ok())
        .map(|m| m.len())
        .sum()
}

/// Converts a plain database at `path` into one encrypted with `key`, WAL and all, and returns
/// whether there was one to convert. Exports into a new file beside it, checks the new file
/// opens with `key` and holds every table, swaps it in, then overwrites the plain file, its WAL
/// and shared memory with zeros before deleting them. `progress` hears the bytes written so
/// far, a few times a second.
///
/// Nothing may have the database open meanwhile. A lock beside it serializes callers across
/// processes; the second finds it converted. An interrupted conversion is finished, or undone
/// and redone, by the next call.
pub fn encrypt_in_place(
    path: &Path,
    key: &DatabaseKey,
    progress: &(dyn Fn(u64) + Sync),
) -> Result<bool> {
    let exported = sidecar(path, "-encrypting");
    let replaced = sidecar(path, "-plain");
    // Nothing to convert and nothing left over, the usual case, takes no lock.
    if file_state(path)? != FileState::Plain && !exported.exists() && !replaced.exists() {
        return Ok(false);
    }

    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(sidecar(path, "-encrypt.lock"))?;
    lock.lock()?;
    recover(path, &exported, &replaced)?;
    if file_state(path)? != FileState::Plain {
        return Ok(false);
    }

    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    keep_wal_on_close(&conn)?;
    // Brings in what the WAL holds, so the export is complete however the last run ended.
    conn.query_row("PRAGMA wal_checkpoint(FULL)", [], |_| Ok(()))?;
    let original = fingerprint(&conn)?;
    let user_version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    let exporting = || -> rusqlite::Result<()> {
        conn.execute(
            &format!("ATTACH DATABASE ?1 AS encrypted KEY {}", key.sql_literal()),
            [exported.to_string_lossy()],
        )?;
        conn.query_row("SELECT sqlcipher_export('encrypted')", [], |_| Ok(()))?;
        conn.execute_batch(&format!(
            "PRAGMA encrypted.user_version = {user_version}; DETACH DATABASE encrypted;"
        ))
    };
    let done = std::sync::atomic::AtomicBool::new(false);
    let exported_result = std::thread::scope(|s| {
        s.spawn(|| {
            while !done.load(std::sync::atomic::Ordering::Relaxed) {
                progress(fs::metadata(&exported).map(|m| m.len()).unwrap_or(0));
                std::thread::sleep(Duration::from_millis(200));
            }
        });
        let result = exporting();
        done.store(true, std::sync::atomic::Ordering::Relaxed);
        result
    });
    if let Err(e) = exported_result {
        drop(conn);
        let _ = fs::remove_file(&exported);
        return Err(e.into());
    }
    // Closing checkpoints what is left; the WAL stays, to be overwritten below.
    drop(conn);
    // Writable, as Windows flushes only a handle that can write.
    fs::OpenOptions::new().write(true).open(&exported)?.sync_all()?;
    progress(fs::metadata(&exported)?.len());

    // The copy must open with the key and hold everything, every row under its own rowid,
    // before the original goes.
    let check = Connection::open(&exported)?;
    apply_key(&check, key)?;
    let copied = fingerprint(&check)?;
    drop(check);
    if copied != original {
        let _ = fs::remove_file(&exported);
        return Err(Error::Database(format!(
            "The encrypted copy of {} differs from it, so it is left as it was",
            path.display()
        )));
    }

    for suffix in ["-wal", "-shm", "-journal"] {
        wipe(&sidecar(path, suffix))?;
    }
    fs::rename(path, &replaced)?;
    fs::rename(&exported, path)?;
    sync_dir(path);
    wipe(&replaced)?;
    // Another caller waiting on the lock holds its own handle, so this only tidies.
    let _ = fs::remove_file(sidecar(path, "-encrypt.lock"));
    Ok(true)
}

/// Finishes or undoes a conversion that stopped part way: the copy swapped in when the plain
/// file had already moved aside, the plain file put back when there was no copy to swap in,
/// and a half-written copy deleted.
fn recover(path: &Path, exported: &Path, replaced: &Path) -> Result<()> {
    if replaced.exists() {
        if !path.exists() {
            if file_state(exported)? == FileState::Encrypted {
                fs::rename(exported, path)?;
            } else {
                fs::rename(replaced, path)?;
            }
        }
        if replaced.exists() {
            wipe(replaced)?;
        }
    }
    if exported.exists() {
        fs::remove_file(exported)?;
    }
    Ok(())
}

/// What a copy must match: every table and index by name, and each table's row count and the
/// total of its rowids, so rows renumbered in the copy show. `sqlcipher_export` keeps rowids by
/// copying each table whole, which SQLite does for an empty table of the same schema.
fn fingerprint(conn: &Connection) -> rusqlite::Result<Vec<(String, i64, f64)>> {
    let names: Vec<(String, String)> = conn
        .prepare(
            "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY 1, 2",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    names
        .into_iter()
        .map(|(kind, name)| {
            if kind != "table" {
                return Ok((format!("{kind} {name}"), 0, 0.0));
            }
            let table = format!("\"{}\"", name.replace('"', "\"\""));
            let count = |sql: String| conn.query_row(&sql, [], |r| Ok((r.get(0)?, r.get(1)?)));
            // A table without rowids, or a virtual one that has none, by its rows alone.
            let (rows, rowids) = count(format!("SELECT count(*), total(rowid) FROM {table}"))
                .or_else(|_| count(format!("SELECT count(*), 0.0 FROM {table}")))?;
            Ok((format!("{kind} {name}"), rows, rowids))
        })
        .collect()
}

/// Keeps the WAL file when `conn` closes, rather than SQLite deleting it unread, so it can be
/// overwritten before it goes.
fn keep_wal_on_close(conn: &Connection) -> Result<()> {
    let mut on: std::ffi::c_int = 1;
    // SAFETY: `conn` is open for the call, "main" is a NUL-terminated schema name, and
    // SQLITE_FCNTL_PERSIST_WAL takes a pointer to an int it reads and may write.
    let rc = unsafe {
        rusqlite::ffi::sqlite3_file_control(
            conn.handle(),
            c"main".as_ptr(),
            rusqlite::ffi::SQLITE_FCNTL_PERSIST_WAL,
            (&mut on as *mut std::ffi::c_int).cast(),
        )
    };
    if rc != rusqlite::ffi::SQLITE_OK {
        return Err(Error::Database(format!("Failed to keep the WAL on close: {rc}")));
    }
    Ok(())
}

/// Overwrites the file at `path` with zeros, flushed, then deletes it. Nothing there is fine.
fn wipe(path: &Path) -> Result<()> {
    let mut file = match fs::OpenOptions::new().write(true).open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    let len = file.metadata()?.len();
    let zeros = vec![0u8; 1 << 20];
    let mut left = len;
    while left > 0 {
        let n = left.min(zeros.len() as u64) as usize;
        file.write_all(&zeros[..n])?;
        left -= n as u64;
    }
    file.sync_all()?;
    drop(file);
    fs::remove_file(path)?;
    Ok(())
}

/// Flushes the directory holding `path`, so its renames survive a crash. Only Unix can.
fn sync_dir(path: &Path) {
    #[cfg(unix)]
    if let Some(dir) = path.parent()
        && let Ok(dir) = fs::File::open(dir)
    {
        let _ = dir.sync_all();
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// `path` with `suffix` added, as SQLite names a database's WAL `<path>-wal`.
fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(n: u8) -> DatabaseKey {
        DatabaseKey::from_bytes([n; 32])
    }

    fn contains(path: &Path, needle: &[u8]) -> bool {
        fs::read(path).map(|b| b.windows(needle.len()).any(|w| w == needle)).unwrap_or(false)
    }

    #[test]
    fn opens_only_with_its_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        let conn = Connection::open(&path).unwrap();
        apply_key(&conn, &key(1)).unwrap();
        conn.execute_batch("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('Bearer secret');")
            .unwrap();
        drop(conn);
        assert_eq!(file_state(&path).unwrap(), FileState::Encrypted);
        assert!(!contains(&path, b"Bearer secret"));

        let wrong = Connection::open(&path).unwrap();
        let err = apply_key(&wrong, &key(2)).unwrap_err();
        assert!(err.to_string().contains("file is not a database"), "{err}");
        let none = Connection::open(&path).unwrap();
        assert!(none.query_row("SELECT count(*) FROM t", [], |r| r.get::<_, i64>(0)).is_err());

        let right = Connection::open(&path).unwrap();
        apply_key(&right, &key(1)).unwrap();
        let v: String = right.query_row("SELECT v FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(v, "Bearer secret");
        assert_eq!(format!("{:?}", key(1)), "DatabaseKey(..)");
    }

    #[test]
    fn a_plain_file_does_not_open_with_a_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        assert_eq!(file_state(&path).unwrap(), FileState::Missing);
        Connection::open(&path).unwrap().execute_batch("CREATE TABLE t (v TEXT)").unwrap();
        assert_eq!(file_state(&path).unwrap(), FileState::Plain);
        assert!(apply_key(&Connection::open(&path).unwrap(), &key(1)).is_err());
    }

    #[test]
    fn converts_a_plain_database_with_its_wal() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        let live = dir.path().join("live.sqlite");
        let conn = Connection::open(&live).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch(
            "PRAGMA user_version = 7;
            CREATE TABLE t (v TEXT); CREATE INDEX t_v ON t (v);
            INSERT INTO t VALUES ('in the main file');",
        )
        .unwrap();
        conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())).unwrap();
        // Left in the WAL, as a crash would leave it.
        keep_wal_on_close(&conn).unwrap();
        conn.execute_batch("PRAGMA wal_autocheckpoint = 0; INSERT INTO t VALUES ('only in wal');")
            .unwrap();
        // The files as a crash leaves them, nothing checkpointed or closed: copied while the
        // connection is open, which then closes, so no handle outlives the test.
        fs::copy(&live, &path).unwrap();
        fs::copy(sidecar(&live, "-wal"), sidecar(&path, "-wal")).unwrap();
        drop(conn);
        assert!(contains(&sidecar(&path, "-wal"), b"only in wal"));
        assert!(!contains(&path, b"only in wal"));
        assert!(plain_size(&path) > 0);

        let seen = std::sync::Mutex::new(Vec::new());
        assert!(encrypt_in_place(&path, &key(1), &|n| seen.lock().unwrap().push(n)).unwrap());
        assert!(seen.lock().unwrap().last().is_some_and(|n| *n > 0));
        assert_eq!(file_state(&path).unwrap(), FileState::Encrypted);
        for suffix in ["-wal", "-shm", "-plain", "-encrypting"] {
            assert!(!sidecar(&path, suffix).exists(), "{suffix} left behind");
        }
        assert!(!contains(&path, b"only in wal") && !contains(&path, b"in the main file"));

        let conn = Connection::open(&path).unwrap();
        apply_key(&conn, &key(1)).unwrap();
        let rows: Vec<String> = conn
            .prepare("SELECT v FROM t ORDER BY v")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(rows, ["in the main file", "only in wal"]);
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, 7);
        drop(conn);

        // Already encrypted, the second call does nothing.
        assert!(!encrypt_in_place(&path, &key(1), &|_| {}).unwrap());
    }

    /// Rows keep their rowids, gaps from deleted rows and all, as flows' numbers are theirs.
    #[test]
    fn keeps_rowids() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE flows (id TEXT NOT NULL PRIMARY KEY, started INTEGER);
            CREATE INDEX flows_started ON flows (started, id);
            CREATE TABLE marks (id INTEGER PRIMARY KEY, max_rowid INTEGER);",
        )
        .unwrap();
        for i in 0..20 {
            conn.execute("INSERT INTO flows VALUES (?1, ?1)", [i]).unwrap();
        }
        conn.execute_batch(
            "DELETE FROM flows WHERE started < 5 OR started IN (9, 12);
            INSERT INTO marks VALUES (3, 12);",
        )
        .unwrap();
        let rowids = |conn: &Connection| -> Vec<(i64, String)> {
            conn.prepare("SELECT rowid, id FROM flows ORDER BY rowid")
                .unwrap()
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        let before = rowids(&conn);
        drop(conn);

        assert!(encrypt_in_place(&path, &key(1), &|_| {}).unwrap());
        let conn = Connection::open(&path).unwrap();
        apply_key(&conn, &key(1)).unwrap();
        assert_eq!(rowids(&conn), before);
        let mark: (i64, i64) = conn
            .query_row("SELECT id, max_rowid FROM marks", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(mark, (3, 12));
        // New rows carry on from the last, not from the count.
        conn.execute("INSERT INTO flows VALUES ('new', 99)", []).unwrap();
        let last: i64 = conn.query_row("SELECT max(rowid) FROM flows", [], |r| r.get(0)).unwrap();
        assert_eq!(last, 21);
    }

    #[test]
    fn finishes_a_swap_that_stopped_halfway() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        let plain = sidecar(&path, "-plain");
        let exported = sidecar(&path, "-encrypting");
        Connection::open(&path).unwrap().execute_batch("CREATE TABLE t (v TEXT)").unwrap();

        // Stopped mid-export: the half copy goes and the conversion runs again.
        fs::write(&exported, b"half").unwrap();
        assert!(encrypt_in_place(&path, &key(1), &|_| {}).unwrap());
        assert!(!exported.exists());

        // Stopped between the renames: the plain file aside, the copy not yet in place.
        fs::rename(&path, &exported).unwrap();
        Connection::open(&path).unwrap().execute_batch("CREATE TABLE t (v TEXT)").unwrap();
        fs::rename(&path, &plain).unwrap();
        assert!(!encrypt_in_place(&path, &key(1), &|_| {}).unwrap());
        assert_eq!(file_state(&path).unwrap(), FileState::Encrypted);
        assert!(!plain.exists() && !exported.exists());

        // Stopped with the plain file aside and no copy: it is put back and converted.
        fs::remove_file(&path).unwrap();
        Connection::open(&plain).unwrap().execute_batch("CREATE TABLE t (v TEXT)").unwrap();
        assert!(encrypt_in_place(&path, &key(1), &|_| {}).unwrap());
        assert!(!plain.exists());
        let conn = Connection::open(&path).unwrap();
        apply_key(&conn, &key(1)).unwrap();
        assert_eq!(fingerprint(&conn).unwrap(), [("table t".to_string(), 0, 0.0)]);
    }
}
