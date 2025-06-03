use crate::error::Result;
use log::{error, info};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use sha2::{Digest, Sha384};
use std::fs;
use std::path::Path;
use std::result::Result as StdResult;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, Runtime};

pub(crate) fn must_migrate_db<R: Runtime>(
    app_handle: &AppHandle<R>,
    pool: &Pool<SqliteConnectionManager>,
) -> Result<()> {
    let migrations_dir = app_handle
        .path()
        .resolve("migrations", BaseDirectory::Resource)
        .expect("failed to resolve resource");

    info!("Running database migrations from: {:?}", migrations_dir);

    // Ensure the table exists
    // NOTE: Yaak used to use sqlx for migrations, so we need to mirror that table structure. We
    //  are writing checksum but not verifying because we want to be able to change migrations after
    //  a release in case something breaks.
    pool.get()?.execute(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (
            version        BIGINT PRIMARY KEY,
            description    TEXT NOT NULL,
            installed_on   TIMESTAMP default CURRENT_TIMESTAMP NOT NULL,
            success        BOOLEAN                             NOT NULL,
            checksum       BLOB                                NOT NULL,
            execution_time BIGINT                              NOT NULL
        )",
        [],
    )?;

    // Read and sort all .sql files
    let mut entries = fs::read_dir(migrations_dir)
        .expect("Failed to find migrations directory")
        .filter_map(StdResult::ok)
        .filter(|e| e.path().extension().map(|ext| ext == "sql").unwrap_or(false))
        .collect::<Vec<_>>();

    // Ensure they're in the correct order
    entries.sort_by_key(|e| e.file_name());

    // Run each migration in a transaction
    for entry in entries {
        let mut conn = pool.get()?;
        let mut tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        match run_migration(entry.path().as_path(), &mut tx) {
            Ok(_) => tx.commit()?,
            Err(e) => {
                error!("Failed to apply migration {:?} {e:?}", entry.path().file_name());
                tx.rollback()?;
                return Err(e);
            }
        };
    }

    info!("Finished running migrations");

    Ok(())
}

fn run_migration(migration_path: &Path, tx: &mut rusqlite::Transaction) -> Result<bool> {
    let start = std::time::Instant::now();
    let (version, description) =
        split_migration_filename(migration_path.file_name().unwrap().to_str().unwrap())
            .expect("Failed to parse migration filename");

    // Skip if already applied
    let row: Option<i64> = tx
        .query_row("SELECT 1 FROM _sqlx_migrations WHERE version = ?", [version.clone()], |r| {
            r.get(0)
        })
        .optional()?;

    if row.is_some() {
        // Migration was already run
        return Ok(false);
    }

    let sql = fs::read_to_string(migration_path).expect("Failed to read migration file");
    info!("Applying migration {description}");

    // Split on `;`? → optional depending on how your SQL is structured
    tx.execute_batch(&sql)?;

    let execution_time = start.elapsed().as_nanos() as i64;
    let checksum = sha384_hex_prefixed(sql.as_bytes());

    // NOTE: The success column is never used. It's just there for sqlx compatibility.
    tx.execute(
        "INSERT INTO _sqlx_migrations (version, description, execution_time, checksum, success) VALUES (?, ?, ?, ?, ?)",
        params![version, description, execution_time, checksum, true],
    )?;

    Ok(true)
}

fn split_migration_filename(filename: &str) -> Option<(String, String)> {
    // Remove the .sql extension
    let trimmed = filename.strip_suffix(".sql")?;

    // Split on the first underscore
    let mut parts = trimmed.splitn(2, '_');
    let version = parts.next()?.to_string();
    let description = parts.next()?.to_string();

    Some((version, description))
}

fn sha384_hex_prefixed(input: &[u8]) -> String {
    let mut hasher = Sha384::new();
    hasher.update(input);
    let result = hasher.finalize();

    // Format as 0x... with uppercase hex
    format!("0x{}", hex::encode_upper(result))
}
