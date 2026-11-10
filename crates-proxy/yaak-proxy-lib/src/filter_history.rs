//! Filters applied from the search box, most recent first, which its magnifier lists.

use crate::db::ProxyQueryManager;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How many filters are kept; applying one more forgets the oldest.
pub const MAX_FILTERS: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct FilterHistoryEntry {
    /// The filter, as the search box took it.
    pub filter: String,
    /// When it was last applied.
    pub applied_at: String,
}

fn failed(what: &str, e: impl std::fmt::Display) -> String {
    format!("Failed to {what} the filter history: {e}")
}

/// Every filter kept, most recently applied first. Empty for a database from before the
/// history, read without migrating.
pub fn list(db: &ProxyQueryManager) -> Result<Vec<FilterHistoryEntry>, String> {
    db.with_conn(|c| {
        let conn = c.conn().resolve();
        // Applying one again inserts it anew, so the newest row is the latest applied.
        let Ok(mut stmt) = conn.prepare(
            "SELECT filter, applied_at FROM filter_history ORDER BY rowid DESC LIMIT ?",
        ) else {
            return Ok(Vec::new());
        };
        stmt.query_map([MAX_FILTERS as i64], |row| {
            Ok(FilterHistoryEntry { filter: row.get(0)?, applied_at: row.get(1)? })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|e| failed("list", e))
    })
}

/// Puts `filter` at the top, once, and forgets all but the newest [`MAX_FILTERS`]. A blank
/// filter is not kept. Returns whether it was recorded.
pub fn record(db: &ProxyQueryManager, filter: &str) -> Result<bool, String> {
    let filter = filter.trim();
    if filter.is_empty() {
        return Ok(false);
    }
    db.with_tx(|c| {
        let conn = c.conn().resolve();
        conn.execute("DELETE FROM filter_history WHERE filter = ?", [filter])?;
        conn.execute("INSERT INTO filter_history (filter) VALUES (?)", [filter])?;
        conn.execute(
            "DELETE FROM filter_history WHERE rowid NOT IN \
            (SELECT rowid FROM filter_history ORDER BY rowid DESC LIMIT ?)",
            [MAX_FILTERS as i64],
        )?;
        Ok::<_, yaak_database::Error>(true)
    })
    .map_err(|e| failed("record", e))
}

/// Forgets one filter. False when it was not kept.
pub fn delete(db: &ProxyQueryManager, filter: &str) -> Result<bool, String> {
    db.with_tx(|c| {
        c.conn()
            .resolve()
            .execute("DELETE FROM filter_history WHERE filter = ?", [filter.trim()])
            .map(|n| n > 0)
            .map_err(yaak_database::Error::from)
    })
    .map_err(|e| failed("remove from", e))
}

/// Forgets every filter. Returns how many there were.
pub fn clear(db: &ProxyQueryManager) -> Result<usize, String> {
    db.with_tx(|c| {
        c.conn()
            .resolve()
            .execute("DELETE FROM filter_history", [])
            .map_err(yaak_database::Error::from)
    })
    .map_err(|e| failed("clear", e))
}

/// The filter the window last applied, in any way, or empty for none. Empty for a database from
/// before it, read without migrating.
pub fn last(db: &ProxyQueryManager) -> Result<String, String> {
    db.with_conn(|c| {
        let conn = c.conn().resolve();
        let Ok(mut stmt) = conn.prepare("SELECT filter FROM last_filter WHERE id = 1") else {
            return Ok(String::new());
        };
        match stmt.query_row([], |row| row.get(0)) {
            Ok(filter) => Ok(filter),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(String::new()),
            Err(e) => Err(failed("read the last filter from", e)),
        }
    })
}

/// Keeps the filter the window applied, for the next launch to restore.
pub fn set_last(db: &ProxyQueryManager, filter: &str) -> Result<(), String> {
    db.with_tx(|c| {
        c.conn()
            .resolve()
            .execute(
                "INSERT INTO last_filter (id, filter) VALUES (1, ?) \
                ON CONFLICT (id) DO UPDATE SET filter = excluded.filter",
                [filter],
            )
            .map(|_| ())
            .map_err(yaak_database::Error::from)
    })
    .map_err(|e| failed("keep the last filter in", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open(dir: &tempfile::TempDir) -> ProxyQueryManager {
        ProxyQueryManager::new(&dir.path().join("proxy.db"), &crate::db::test_key()).unwrap()
    }

    fn filters(db: &ProxyQueryManager) -> Vec<String> {
        list(db).unwrap().into_iter().map(|e| e.filter).collect()
    }

    #[test]
    fn records_once_each_with_the_latest_first() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(&dir);
        assert_eq!(filters(&db), Vec::<String>::new());

        assert!(record(&db, " @status:>=400 ").unwrap());
        assert!(record(&db, "stripe").unwrap());
        assert!(record(&db, "@method:post").unwrap());
        assert_eq!(filters(&db), ["@method:post", "stripe", "@status:>=400"]);

        // Applied again, it moves to the top rather than being listed twice.
        assert!(record(&db, "@status:>=400").unwrap());
        assert_eq!(filters(&db), ["@status:>=400", "@method:post", "stripe"]);

        // Nothing to keep for a blank one.
        assert!(!record(&db, "  ").unwrap());
        assert_eq!(filters(&db).len(), 3);
        assert!(!list(&db).unwrap()[0].applied_at.is_empty());
    }

    #[test]
    fn keeps_the_newest_fifty() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(&dir);
        for i in 0..MAX_FILTERS + 5 {
            record(&db, &format!("f{i}")).unwrap();
        }
        let kept = filters(&db);
        assert_eq!(kept.len(), MAX_FILTERS);
        assert_eq!(kept.first().map(String::as_str), Some("f54"));
        assert_eq!(kept.last().map(String::as_str), Some("f5"));

        // One applied again from the bottom is kept, and none other is lost for it.
        record(&db, "f5").unwrap();
        let kept = filters(&db);
        assert_eq!((kept.len(), kept[0].as_str()), (MAX_FILTERS, "f5"));
        assert!(kept.contains(&"f6".to_string()));
    }

    #[test]
    fn keeps_the_last_filter_applied() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(&dir);
        assert_eq!(last(&db).unwrap(), "");
        set_last(&db, "@host:*.github.com").unwrap();
        set_last(&db, "stripe").unwrap();
        assert_eq!(last(&db).unwrap(), "stripe");
        set_last(&db, "").unwrap();
        assert_eq!(last(&db).unwrap(), "");
        // Apart from the history, which only Enter writes.
        assert_eq!(filters(&db), Vec::<String>::new());
    }

    #[test]
    fn removes_one_or_all() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(&dir);
        for f in ["a", "b", "c"] {
            record(&db, f).unwrap();
        }
        assert!(delete(&db, "b").unwrap());
        assert!(!delete(&db, "b").unwrap());
        assert_eq!(filters(&db), ["c", "a"]);
        assert_eq!(clear(&db).unwrap(), 2);
        assert_eq!(filters(&db), Vec::<String>::new());
    }
}
