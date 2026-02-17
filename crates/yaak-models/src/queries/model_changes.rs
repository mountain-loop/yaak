use crate::db_context::DbContext;
use crate::error::Result;
use crate::util::ModelPayload;
use rusqlite::params;
use rusqlite::types::Type;

#[derive(Debug, Clone)]
pub struct PersistedModelChange {
    pub id: i64,
    pub created_at: String,
    pub payload: ModelPayload,
}

impl<'a> DbContext<'a> {
    pub fn list_model_changes_after(
        &self,
        after_id: i64,
        limit: usize,
    ) -> Result<Vec<PersistedModelChange>> {
        let mut stmt = self.conn.prepare(
            r#"
                SELECT id, created_at, payload
                FROM model_changes
                WHERE id > ?1
                ORDER BY id ASC
                LIMIT ?2
            "#,
        )?;

        let items = stmt.query_map(params![after_id, limit as i64], |row| {
            let id: i64 = row.get(0)?;
            let created_at: String = row.get(1)?;
            let payload_raw: String = row.get(2)?;
            let payload = serde_json::from_str::<ModelPayload>(&payload_raw).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(2, Type::Text, Box::new(e))
            })?;
            Ok(PersistedModelChange { id, created_at, payload })
        })?;

        Ok(items.collect::<std::result::Result<Vec<_>, rusqlite::Error>>()?)
    }

    pub fn list_model_changes_since(
        &self,
        since_created_at: &str,
        since_id: i64,
        limit: usize,
    ) -> Result<Vec<PersistedModelChange>> {
        let mut stmt = self.conn.prepare(
            r#"
                SELECT id, created_at, payload
                FROM model_changes
                WHERE created_at > ?1
                   OR (created_at = ?1 AND id > ?2)
                ORDER BY created_at ASC, id ASC
                LIMIT ?3
            "#,
        )?;

        let items = stmt.query_map(params![since_created_at, since_id, limit as i64], |row| {
            let id: i64 = row.get(0)?;
            let created_at: String = row.get(1)?;
            let payload_raw: String = row.get(2)?;
            let payload = serde_json::from_str::<ModelPayload>(&payload_raw).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(2, Type::Text, Box::new(e))
            })?;
            Ok(PersistedModelChange { id, created_at, payload })
        })?;

        Ok(items.collect::<std::result::Result<Vec<_>, rusqlite::Error>>()?)
    }

    pub fn prune_model_changes_older_than_days(&self, days: i64) -> Result<usize> {
        let offset = format!("-{days} days");
        Ok(self.conn.resolve().execute(
            r#"
                DELETE FROM model_changes
                WHERE created_at < STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW', ?1)
            "#,
            params![offset],
        )?)
    }

    pub fn prune_model_changes_older_than_hours(&self, hours: i64) -> Result<usize> {
        let offset = format!("-{hours} hours");
        Ok(self.conn.resolve().execute(
            r#"
                DELETE FROM model_changes
                WHERE created_at < STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW', ?1)
            "#,
            params![offset],
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_in_memory;
    use crate::models::Workspace;
    use crate::util::{ModelChangeEvent, UpdateSource};
    use serde_json::json;

    #[test]
    fn records_model_changes_for_upsert_and_delete() {
        let (query_manager, _blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();

        let workspace = db
            .upsert_workspace(
                &Workspace {
                    name: "Changes Test".to_string(),
                    setting_follow_redirects: true,
                    setting_validate_certificates: true,
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )
            .expect("Failed to upsert workspace");

        let created_changes = db.list_model_changes_after(0, 10).expect("Failed to list changes");
        assert_eq!(created_changes.len(), 1);
        assert_eq!(created_changes[0].payload.model.id(), workspace.id);
        assert_eq!(created_changes[0].payload.model.model(), "workspace");
        assert!(matches!(
            created_changes[0].payload.change,
            ModelChangeEvent::Upsert { created: true }
        ));
        assert!(matches!(created_changes[0].payload.update_source, UpdateSource::Sync));

        db.delete_workspace_by_id(&workspace.id, &UpdateSource::Sync)
            .expect("Failed to delete workspace");

        let all_changes = db.list_model_changes_after(0, 10).expect("Failed to list changes");
        assert_eq!(all_changes.len(), 2);
        assert!(matches!(all_changes[1].payload.change, ModelChangeEvent::Delete));
        assert!(all_changes[1].id > all_changes[0].id);

        let changes_after_first = db
            .list_model_changes_after(all_changes[0].id, 10)
            .expect("Failed to list changes after cursor");
        assert_eq!(changes_after_first.len(), 1);
        assert!(matches!(changes_after_first[0].payload.change, ModelChangeEvent::Delete));
    }

    #[test]
    fn prunes_old_model_changes() {
        let (query_manager, _blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();

        db.upsert_workspace(
            &Workspace {
                name: "Prune Test".to_string(),
                setting_follow_redirects: true,
                setting_validate_certificates: true,
                ..Default::default()
            },
            &UpdateSource::Sync,
        )
        .expect("Failed to upsert workspace");

        let changes = db.list_model_changes_after(0, 10).expect("Failed to list changes");
        assert_eq!(changes.len(), 1);

        db.conn
            .resolve()
            .execute(
                "UPDATE model_changes SET created_at = '2000-01-01 00:00:00.000' WHERE id = ?1",
                params![changes[0].id],
            )
            .expect("Failed to age model change row");

        let pruned =
            db.prune_model_changes_older_than_days(30).expect("Failed to prune model changes");
        assert_eq!(pruned, 1);
        assert!(db.list_model_changes_after(0, 10).expect("Failed to list changes").is_empty());
    }

    #[test]
    fn list_model_changes_since_uses_timestamp_with_id_tiebreaker() {
        let (query_manager, _blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();

        let workspace = db
            .upsert_workspace(
                &Workspace {
                    name: "Cursor Test".to_string(),
                    setting_follow_redirects: true,
                    setting_validate_certificates: true,
                    ..Default::default()
                },
                &UpdateSource::Sync,
            )
            .expect("Failed to upsert workspace");
        db.delete_workspace_by_id(&workspace.id, &UpdateSource::Sync)
            .expect("Failed to delete workspace");

        let all = db.list_model_changes_after(0, 10).expect("Failed to list changes");
        assert_eq!(all.len(), 2);

        let fixed_ts = "2026-02-16 00:00:00.000";
        db.conn
            .resolve()
            .execute("UPDATE model_changes SET created_at = ?1", params![fixed_ts])
            .expect("Failed to normalize timestamps");

        let after_first =
            db.list_model_changes_since(fixed_ts, all[0].id, 10).expect("Failed to query cursor");
        assert_eq!(after_first.len(), 1);
        assert_eq!(after_first[0].id, all[1].id);
    }

    #[test]
    fn prunes_old_model_changes_by_hours() {
        let (query_manager, _blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();

        db.upsert_workspace(
            &Workspace {
                name: "Prune Hour Test".to_string(),
                setting_follow_redirects: true,
                setting_validate_certificates: true,
                ..Default::default()
            },
            &UpdateSource::Sync,
        )
        .expect("Failed to upsert workspace");

        let changes = db.list_model_changes_after(0, 10).expect("Failed to list changes");
        assert_eq!(changes.len(), 1);

        db.conn
            .resolve()
            .execute(
                "UPDATE model_changes SET created_at = STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW', '-2 hours') WHERE id = ?1",
                params![changes[0].id],
            )
            .expect("Failed to age model change row");

        let pruned =
            db.prune_model_changes_older_than_hours(1).expect("Failed to prune model changes");
        assert_eq!(pruned, 1);
    }

    #[test]
    fn list_model_changes_deserializes_http_response_event_payload() {
        let (query_manager, _blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();

        let payload = json!({
            "model": {
                "model": "http_response_event",
                "id": "re_test",
                "createdAt": "2026-02-16T21:01:34.809162",
                "updatedAt": "2026-02-16T21:01:34.809163",
                "workspaceId": "wk_test",
                "responseId": "rs_test",
                "event": {
                    "type": "info",
                    "message": "hello"
                }
            },
            "updateSource": { "type": "sync" },
            "change": { "type": "upsert", "created": false }
        });

        db.conn
            .resolve()
            .execute(
                r#"
                INSERT INTO model_changes (model, model_id, change, update_source, payload)
                VALUES (?1, ?2, ?3, ?4, ?5)
                "#,
                params![
                    "http_response_event",
                    "re_test",
                    r#"{"type":"upsert","created":false}"#,
                    r#"{"type":"sync"}"#,
                    payload.to_string(),
                ],
            )
            .expect("Failed to insert model change row");

        let changes = db.list_model_changes_after(0, 10).expect("Failed to list changes");
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].payload.model.model(), "http_response_event");
        assert_eq!(changes[0].payload.model.id(), "re_test");
    }
}
