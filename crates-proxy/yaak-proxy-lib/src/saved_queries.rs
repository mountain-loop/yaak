//! Searches saved by name, which the sidebar lists with a count each.

use crate::db::ProxyQueryManager;
use crate::flows::{self, FlowFilter};
use crate::query::Hidden;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use yaak_database::generate_prefixed_id;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    /// The search, as the search box takes it.
    pub query: String,
    /// Where it sits in the list, lowest first.
    #[ts(type = "number")]
    pub sort_order: i64,
}

/// How many flows a saved query covers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SavedQueryCount {
    pub id: String,
    #[ts(type = "number")]
    pub count: usize,
}

fn failed(what: &str, e: impl std::fmt::Display) -> String {
    format!("Failed to {what} the saved search: {e}")
}

fn read(row: &rusqlite::Row) -> rusqlite::Result<SavedQuery> {
    Ok(SavedQuery {
        id: row.get("id")?,
        name: row.get("name")?,
        query: row.get("query")?,
        sort_order: row.get("sort_order")?,
    })
}

/// Every saved query, in order. None for a database from before them, read without migrating.
pub fn list(db: &ProxyQueryManager) -> Result<Vec<SavedQuery>, String> {
    db.with_conn(|c| {
        let conn = c.conn().resolve();
        let Ok(mut stmt) =
            conn.prepare("SELECT * FROM saved_queries ORDER BY sort_order, created_at, id")
        else {
            return Ok(Vec::new());
        };
        stmt.query_map([], read)
            .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
            .map_err(|e| failed("list", e))
    })
}

fn name_of(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("A saved search needs a name".into());
    }
    Ok(name.to_string())
}

/// Saves `query` as `name`, after the others.
pub fn create(db: &ProxyQueryManager, name: &str, query: &str) -> Result<SavedQuery, String> {
    let name = name_of(name)?;
    let query = query.trim();
    if query.is_empty() {
        return Err("Nothing to save".into());
    }
    let id = generate_prefixed_id("sq");
    db.with_tx(|c| {
        let conn = c.conn().resolve();
        conn.query_row(
            "INSERT INTO saved_queries (id, name, query, sort_order) \
            VALUES (?1, ?2, ?3, (SELECT coalesce(max(sort_order), -1) + 1 FROM saved_queries)) \
            RETURNING *",
            rusqlite::params![id, name, query],
            read,
        )
        .map_err(yaak_database::Error::from)
    })
    .map_err(|e| failed("save", e))
}

pub fn rename(db: &ProxyQueryManager, id: &str, name: &str) -> Result<SavedQuery, String> {
    let name = name_of(name)?;
    db.with_tx(|c| {
        c.conn()
            .resolve()
            .query_row(
                "UPDATE saved_queries SET name = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 \
                RETURNING *",
                rusqlite::params![id, name],
                read,
            )
            .map_err(yaak_database::Error::from)
    })
    .map_err(|e| failed("rename", e))
}

/// Deletes one. False when there was none.
pub fn delete(db: &ProxyQueryManager, id: &str) -> Result<bool, String> {
    db.with_tx(|c| {
        c.conn()
            .resolve()
            .execute("DELETE FROM saved_queries WHERE id = ?", [id])
            .map(|n| n > 0)
            .map_err(yaak_database::Error::from)
    })
    .map_err(|e| failed("delete", e))
}

/// Each saved query's count of flows, with what `hidden` says left out, as the list would show
/// it, read from one snapshot.
pub fn counts(db: &ProxyQueryManager, hidden: Hidden) -> Result<Vec<SavedQueryCount>, String> {
    let saved = list(db)?;
    let filters: Vec<FlowFilter> = saved
        .iter()
        .map(|s| FlowFilter {
            hide_system: hidden.system,
            hide_encrypted: hidden.encrypted,
            ..FlowFilter::search(s.query.clone())
        })
        .collect();
    let counts = flows::count_each(db, &filters)?;
    Ok(saved
        .into_iter()
        .zip(counts)
        .map(|(s, count)| SavedQueryCount { id: s.id, count })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_renames_counts_and_deletes() {
        use crate::models::Flow;
        use yaak_database::UpdateSource;
        let dir = tempfile::tempdir().unwrap();
        let db =
            ProxyQueryManager::new(&dir.path().join("proxy.db"), &crate::db::test_key()).unwrap();
        for (i, status) in [200, 404, 500].into_iter().enumerate() {
            let flow = Flow {
                id: format!("fl_{i}"),
                url: format!("https://example.com/{i}"),
                status: Some(status),
                ..Default::default()
            };
            db.with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background)).unwrap();
        }

        let errors = create(&db, " Errors ", "@status:>=400").unwrap();
        let ok = create(&db, "OK", "@status:2xx").unwrap();
        assert_eq!((errors.name.as_str(), errors.sort_order, ok.sort_order), ("Errors", 0, 1));
        assert!(create(&db, " ", "x").is_err());
        assert!(create(&db, "x", " ").is_err());

        let renamed = rename(&db, &ok.id, "Fine").unwrap();
        assert_eq!(renamed.name, "Fine");
        assert_eq!(
            list(&db).unwrap().iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            ["Errors", "Fine"]
        );

        let counts = counts(&db, false.into()).unwrap();
        assert_eq!(
            counts,
            vec![
                SavedQueryCount { id: errors.id.clone(), count: 2 },
                SavedQueryCount { id: ok.id.clone(), count: 1 },
            ]
        );

        assert!(delete(&db, &errors.id).unwrap());
        assert!(!delete(&db, &errors.id).unwrap());
        assert_eq!(list(&db).unwrap(), vec![renamed]);
    }
}
