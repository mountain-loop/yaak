use crate::error::Result;
use include_dir::Dir;
use log::{debug, info};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{OptionalExtension, params};

const TRACKING_TABLE: &str = "_sqlx_migrations";

/// Run SQL migrations from an embedded directory.
///
/// Migrations are sorted by filename (use timestamp prefixes like `00000001_init.sql`).
/// Applied migrations are tracked in `_sqlx_migrations`.
pub fn run_migrations(pool: &Pool<SqliteConnectionManager>, dir: &Dir<'_>) -> Result<()> {
    info!("Running migrations");

    // Create tracking table
    pool.get()?.execute(
        &format!(
            "CREATE TABLE IF NOT EXISTS {TRACKING_TABLE} (
                version     TEXT PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
            )"
        ),
        [],
    )?;

    // Read and sort all .sql files
    let mut entries: Vec<_> = dir
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
            .query_row(
                &format!("SELECT 1 FROM {TRACKING_TABLE} WHERE version = ?"),
                [version],
                |r| r.get(0),
            )
            .optional()?;

        if already_applied.is_some() {
            debug!("Skipping already applied migration: {}", filename);
            continue;
        }

        let sql =
            entry.as_file().unwrap().contents_utf8().expect("Failed to read migration file");

        info!("Applying migration: {}", filename);
        let conn = pool.get()?;
        conn.execute_batch(sql)?;

        // Record migration
        conn.execute(
            &format!("INSERT INTO {TRACKING_TABLE} (version, description) VALUES (?, ?)"),
            params![version, filename],
        )?;

        ran_migrations += 1;
    }

    if ran_migrations == 0 {
        info!("No migrations to run");
    } else {
        info!("Ran {} migration(s)", ran_migrations);
    }

    Ok(())
}
