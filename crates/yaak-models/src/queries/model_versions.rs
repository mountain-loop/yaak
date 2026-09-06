use crate::client_db::ClientDb;
use crate::error::Result;
use crate::models::{
    GrpcRequest, HttpRequest, ModelVersion, ModelVersionIden, ModelVersionReason, UpsertModelInfo,
    WebsocketRequest,
};
use crate::queries::any_request::AnyRequest;
use crate::util::UpdateSource;
use crate::versions::{apply_version_document, content_hash, version_document};
use sea_query::{Expr, ExprTrait, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;

/// Unreferenced versions older than this are dropped.
const RETENTION_DAYS: i64 = 30;

/// How many unreferenced versions a request keeps, newest first.
const RETENTION_COUNT: i64 = 50;

impl<'a> ClientDb<'a> {
    pub fn get_model_version(&self, id: &str) -> Result<ModelVersion> {
        self.find_one(ModelVersionIden::Id, id)
    }

    /// Every version of one model, newest first.
    pub fn list_model_versions(&self, model_id: &str) -> Result<Vec<ModelVersion>> {
        self.find_many(ModelVersionIden::ModelId, model_id, None)
    }

    /// Capture a request's current content, or return the version that already
    /// holds it.
    ///
    /// The single entry point for creating versions. Callers do not check
    /// whether anything changed first — that is what content addressing is for,
    /// and it is why a send, a window blur and an idle timer can all call this
    /// on the same unedited request and leave one row behind.
    pub fn snapshot_request(
        &self,
        request: &AnyRequest,
        reason: ModelVersionReason,
    ) -> Result<ModelVersion> {
        let document = version_document(&request.to_value()?)?;
        let content_hash = content_hash(&document)?;

        if let Some(existing) = self.find_version_by_hash(request.id(), &content_hash) {
            return Ok(existing);
        }

        let version = self.upsert_untracked(&ModelVersion {
            workspace_id: request.workspace_id().to_string(),
            model_type: request.model_type().to_string(),
            model_id: request.id().to_string(),
            content_hash,
            document,
            reason,
            ..Default::default()
        })?;

        self.prune_model_versions(request.id())?;

        Ok(version)
    }

    pub fn snapshot_request_by_id(
        &self,
        request_id: &str,
        reason: ModelVersionReason,
    ) -> Result<ModelVersion> {
        self.snapshot_request(&self.get_any_request(request_id)?, reason)
    }

    /// Write a version's content back over the live request.
    ///
    /// Anything the live request has picked up since its last version is
    /// captured first, so a restore is never the thing that loses an edit. The
    /// content being written already has a version — the one being restored —
    /// so this leaves no new row behind.
    pub fn restore_request_version(
        &self,
        version_id: &str,
        source: &UpdateSource,
    ) -> Result<AnyRequest> {
        let version = self.get_model_version(version_id)?;
        let live = self.get_any_request(&version.model_id)?;
        self.snapshot_request(&live, ModelVersionReason::Restore)?;

        let restored = apply_version_document(&live.to_value()?, &version.document);
        Ok(match live {
            AnyRequest::HttpRequest(_) => AnyRequest::HttpRequest(
                self.upsert_http_request(&serde_json::from_value::<HttpRequest>(restored)?, source)?,
            ),
            AnyRequest::GrpcRequest(_) => AnyRequest::GrpcRequest(
                self.upsert_grpc_request(&serde_json::from_value::<GrpcRequest>(restored)?, source)?,
            ),
            AnyRequest::WebsocketRequest(_) => AnyRequest::WebsocketRequest(
                self.upsert_websocket_request(
                    &serde_json::from_value::<WebsocketRequest>(restored)?,
                    source,
                )?,
            ),
        })
    }

    /// Whether a request's content has moved on from a given version.
    pub fn request_matches_version(&self, version: &ModelVersion) -> Result<bool> {
        let live = self.get_any_request(&version.model_id)?;
        let hash = content_hash(&version_document(&live.to_value()?)?)?;
        Ok(hash == version.content_hash)
    }

    pub fn delete_model_versions_for_model(&self, model_id: &str) -> Result<usize> {
        self.delete_many_untracked::<ModelVersion>(ModelVersionIden::ModelId, model_id)
    }

    /// Drop the versions a request no longer needs.
    ///
    /// A version referenced by a response outlives retention entirely — the
    /// point of the feature is that an old response can still show what sent
    /// it. Everything else is history the user has not asked to keep, and
    /// survives only while it is both recent and among the newest few.
    pub fn prune_model_versions(&self, model_id: &str) -> Result<usize> {
        let cutoff = format!("-{RETENTION_DAYS} days");
        let sql = r#"
            DELETE FROM model_versions
            WHERE model_id = ?1
              AND id NOT IN (
                  SELECT version_id FROM http_responses WHERE request_id = ?1 AND version_id IS NOT NULL
                  UNION
                  SELECT version_id FROM grpc_connections WHERE request_id = ?1 AND version_id IS NOT NULL
                  UNION
                  SELECT version_id FROM websocket_connections WHERE request_id = ?1 AND version_id IS NOT NULL
              )
              AND (
                  created_at < datetime('now', ?2)
                  OR id NOT IN (
                      SELECT id FROM model_versions WHERE model_id = ?1
                      ORDER BY created_at DESC, rowid DESC LIMIT ?3
                  )
              )
        "#;
        Ok(self.conn().execute(sql, rusqlite::params![model_id, cutoff, RETENTION_COUNT])?)
    }

    fn find_version_by_hash(&self, model_id: &str, content_hash: &str) -> Option<ModelVersion> {
        let (sql, params) = Query::select()
            .from(ModelVersionIden::Table)
            .column(sea_query::Asterisk)
            .cond_where(
                Expr::col(ModelVersionIden::ModelId)
                    .eq(model_id)
                    .and(Expr::col(ModelVersionIden::ContentHash).eq(content_hash)),
            )
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn().prepare(sql.as_str()).ok()?;
        stmt.query_row(&*params.as_params(), ModelVersion::from_row).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client_db::ClientDb;
    use crate::init_in_memory;
    use crate::models::{HttpRequest, HttpResponse, Workspace};

    fn source() -> UpdateSource {
        UpdateSource::Background
    }

    fn seed(db: &ClientDb) -> (Workspace, HttpRequest) {
        let workspace = db
            .upsert_workspace(&Workspace { name: "Versions".to_string(), ..Default::default() }, &source())
            .expect("Failed to upsert workspace");
        let request = db
            .upsert_http_request(
                &HttpRequest {
                    workspace_id: workspace.id.clone(),
                    name: "Original".to_string(),
                    url: "https://example.com/one".to_string(),
                    ..Default::default()
                },
                &source(),
            )
            .expect("Failed to upsert request");
        (workspace, request)
    }

    fn snapshot(db: &ClientDb, request_id: &str, reason: ModelVersionReason) -> ModelVersion {
        db.snapshot_request_by_id(request_id, reason).expect("Failed to snapshot")
    }

    #[test]
    fn snapshotting_unchanged_content_reuses_the_same_version() {
        let (query_manager, _blobs, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        let (_workspace, request) = seed(&db);

        let first = snapshot(&db, &request.id, ModelVersionReason::Send);
        let second = snapshot(&db, &request.id, ModelVersionReason::Idle);
        let third = snapshot(&db, &request.id, ModelVersionReason::Switch);

        assert_eq!(first.id, second.id);
        assert_eq!(first.id, third.id);
        // The first capture's reason is the one that sticks; a version is its content
        assert_eq!(second.reason, ModelVersionReason::Send);
        assert_eq!(db.list_model_versions(&request.id).unwrap().len(), 1);
    }

    #[test]
    fn bookkeeping_writes_do_not_mint_a_version() {
        let (query_manager, _blobs, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        let (_workspace, request) = seed(&db);

        let first = snapshot(&db, &request.id, ModelVersionReason::Send);

        let folder = db
            .upsert_folder(
                &crate::models::Folder {
                    workspace_id: request.workspace_id.clone(),
                    ..Default::default()
                },
                &source(),
            )
            .unwrap();
        db.upsert_http_request(
            &HttpRequest {
                folder_id: Some(folder.id),
                sort_priority: 42.0,
                ..db.get_http_request(&request.id).unwrap()
            },
            &source(),
        )
        .unwrap();

        assert_eq!(snapshot(&db, &request.id, ModelVersionReason::Idle).id, first.id);
        assert_eq!(db.list_model_versions(&request.id).unwrap().len(), 1);
    }

    #[test]
    fn editing_content_mints_a_version() {
        let (query_manager, _blobs, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        let (_workspace, request) = seed(&db);

        snapshot(&db, &request.id, ModelVersionReason::Send);
        db.upsert_http_request(
            &HttpRequest { url: "https://example.com/two".to_string(), ..request.clone() },
            &source(),
        )
        .unwrap();
        snapshot(&db, &request.id, ModelVersionReason::Idle);

        assert_eq!(db.list_model_versions(&request.id).unwrap().len(), 2);
    }

    #[test]
    fn restoring_writes_the_old_content_back_without_a_new_version() {
        let (query_manager, _blobs, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        let (_workspace, request) = seed(&db);

        let original = snapshot(&db, &request.id, ModelVersionReason::Send);
        db.upsert_http_request(
            &HttpRequest {
                url: "https://example.com/two".to_string(),
                name: "Edited".to_string(),
                ..request.clone()
            },
            &source(),
        )
        .unwrap();
        let edited = snapshot(&db, &request.id, ModelVersionReason::Idle);

        db.restore_request_version(&original.id, &source()).expect("Failed to restore");

        let live = db.get_http_request(&request.id).unwrap();
        assert_eq!(live.url, "https://example.com/one");
        assert_eq!(live.name, "Original");
        assert_eq!(live.id, request.id);

        // The restored content already had a version, and the edit it replaced
        // still has its own, so nothing new appears
        let versions = db.list_model_versions(&request.id).unwrap();
        assert_eq!(versions.len(), 2);
        assert!(versions.iter().any(|v| v.id == original.id));
        assert!(versions.iter().any(|v| v.id == edited.id));
    }

    /// The case restore exists to be safe for: an edit that was never captured.
    #[test]
    fn restoring_captures_uncaptured_edits_first() {
        let (query_manager, _blobs, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        let (_workspace, request) = seed(&db);

        let original = snapshot(&db, &request.id, ModelVersionReason::Send);
        db.upsert_http_request(
            &HttpRequest { url: "https://example.com/unsaved".to_string(), ..request.clone() },
            &source(),
        )
        .unwrap();

        db.restore_request_version(&original.id, &source()).expect("Failed to restore");

        let versions = db.list_model_versions(&request.id).unwrap();
        assert_eq!(versions.len(), 2);
        let rescued = versions.iter().find(|v| v.id != original.id).unwrap();
        assert_eq!(rescued.reason, ModelVersionReason::Restore);
        assert_eq!(rescued.document.get("url").unwrap(), "https://example.com/unsaved");
    }

    #[test]
    fn request_matches_version_tracks_the_live_content() {
        let (query_manager, _blobs, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        let (_workspace, request) = seed(&db);

        let version = snapshot(&db, &request.id, ModelVersionReason::Send);
        assert!(db.request_matches_version(&version).unwrap());

        db.upsert_http_request(
            &HttpRequest { url: "https://example.com/two".to_string(), ..request.clone() },
            &source(),
        )
        .unwrap();
        assert!(!db.request_matches_version(&version).unwrap());
    }

    /// Write `count` distinct versions by walking the request's URL forward.
    fn make_versions(db: &ClientDb, request: &HttpRequest, count: usize) -> Vec<ModelVersion> {
        (0..count)
            .map(|i| {
                db.upsert_http_request(
                    &HttpRequest { url: format!("https://example.com/{i}"), ..request.clone() },
                    &source(),
                )
                .unwrap();
                snapshot(db, &request.id, ModelVersionReason::Idle)
            })
            .collect()
    }

    #[test]
    fn unreferenced_versions_are_pruned_to_the_newest_fifty() {
        let (query_manager, _blobs, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        let (_workspace, request) = seed(&db);

        let versions = make_versions(&db, &request, RETENTION_COUNT as usize + 10);

        let kept = db.list_model_versions(&request.id).unwrap();
        assert_eq!(kept.len(), RETENTION_COUNT as usize);
        // The oldest went first
        assert!(!kept.iter().any(|v| v.id == versions[0].id));
        assert!(kept.iter().any(|v| v.id == versions.last().unwrap().id));
    }

    #[test]
    fn a_referenced_version_survives_retention() {
        let (query_manager, blobs, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        let (workspace, request) = seed(&db);

        let pinned = snapshot(&db, &request.id, ModelVersionReason::Send);
        db.upsert_http_response(
            &HttpResponse {
                request_id: request.id.clone(),
                workspace_id: workspace.id.clone(),
                version_id: Some(pinned.id.clone()),
                ..Default::default()
            },
            &source(),
            &blobs,
        )
        .unwrap();

        make_versions(&db, &request, RETENTION_COUNT as usize + 10);

        let kept = db.list_model_versions(&request.id).unwrap();
        assert!(
            kept.iter().any(|v| v.id == pinned.id),
            "a version a response points at must outlive retention",
        );
    }

    #[test]
    fn unreferenced_versions_expire_after_thirty_days() {
        let (query_manager, _blobs, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        let (_workspace, request) = seed(&db);

        let old = snapshot(&db, &request.id, ModelVersionReason::Send);
        db.conn()
            .execute(
                "UPDATE model_versions SET created_at = datetime('now', '-31 days') WHERE id = ?1",
                rusqlite::params![old.id],
            )
            .unwrap();

        // Any later capture prunes
        db.upsert_http_request(
            &HttpRequest { url: "https://example.com/two".to_string(), ..request.clone() },
            &source(),
        )
        .unwrap();
        let fresh = snapshot(&db, &request.id, ModelVersionReason::Idle);

        let kept = db.list_model_versions(&request.id).unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].id, fresh.id);
    }

    #[test]
    fn deleting_a_request_deletes_its_versions() {
        let (query_manager, _blobs, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        let (_workspace, request) = seed(&db);

        make_versions(&db, &request, 3);
        assert!(!db.list_model_versions(&request.id).unwrap().is_empty());

        db.delete_http_request_by_id(&request.id, &source()).unwrap();
        assert!(db.list_model_versions(&request.id).unwrap().is_empty());
    }
}
