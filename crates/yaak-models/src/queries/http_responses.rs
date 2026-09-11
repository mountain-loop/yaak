use crate::blob_manager::BlobManager;
use crate::client_db::{ClientDb, WriteDb};
use crate::error::Result;
use crate::models::{HttpResponse, HttpResponseIden, HttpResponseState};
use crate::queries::MAX_HISTORY_ITEMS;
use crate::util::UpdateSource;
use log::{debug, error};
use sea_query::ExprTrait;
use sea_query::{Expr, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;
use std::fs;

impl<'a> ClientDb<'a> {
    pub fn get_http_response(&self, id: &str) -> Result<HttpResponse> {
        self.find_one(HttpResponseIden::Id, id)
    }

    pub fn list_http_responses_for_request(
        &self,
        request_id: &str,
        limit: Option<u64>,
    ) -> Result<Vec<HttpResponse>> {
        self.find_many(HttpResponseIden::RequestId, request_id, limit)
    }

    pub fn list_http_responses(
        &self,
        workspace_id: &str,
        limit: Option<u64>,
    ) -> Result<Vec<HttpResponse>> {
        self.find_many(HttpResponseIden::WorkspaceId, workspace_id, limit)
    }

    /// Delete blob-stored response bodies whose owning HTTP response row no
    /// longer exists. Blob ids are keyed by the response that owns them —
    /// "{response_id}" for a response body, "{response_id}.request" for the
    /// request that produced it — so ownership is the id's first segment.
    ///
    /// The blob half of [`Self::delete_orphaned_response_bodies`], on its own
    /// for hosts with no filesystem to hold body files. See `crate::hooks`.
    ///
    /// Returns the number of orphaned bodies deleted.
    pub fn delete_orphaned_response_body_blobs(&self, blobs: &BlobManager) -> Result<usize> {
        let orphaned = blobs
            .connect()
            .list_body_ids()?
            .into_iter()
            .filter(|body_id| {
                let response_id = body_id.split('.').next().unwrap_or_default();
                self.find_optional::<HttpResponse>(HttpResponseIden::Id, response_id).is_none()
            })
            .collect::<Vec<_>>();

        blobs.with_tx(|b| {
            for body_id in &orphaned {
                b.delete_chunks(body_id)?;
            }
            Ok::<_, crate::error::Error>(())
        })?;

        Ok(orphaned.len())
    }

    /// Delete response body data (blob chunks and body files) whose owning HTTP
    /// response row no longer exists. Cascaded deletes (request, folder,
    /// workspace) historically never cleaned the blob DB or the responses
    /// directory, so orphans accumulate; this runs in the background at startup.
    ///
    /// Safe against in-flight sends: the response row is created before its
    /// body file or chunks are written.
    ///
    /// Returns the number of orphaned bodies deleted.
    pub fn delete_orphaned_response_bodies(
        &self,
        blobs: &BlobManager,
        responses_dir: &std::path::Path,
    ) -> Result<usize> {
        let mut deleted = self.delete_orphaned_response_body_blobs(blobs)?;

        // Body files are stored as {responses_dir}/{response_id}
        if let Ok(entries) = fs::read_dir(responses_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let Some(response_id) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if self.find_optional::<HttpResponse>(HttpResponseIden::Id, response_id).is_some() {
                    continue;
                }
                if fs::remove_file(&path).is_ok() {
                    deleted += 1;
                }
            }
        }

        Ok(deleted)
    }
}

impl<'a> WriteDb<'a> {
    /// Returns the number of responses deleted.
    pub fn delete_all_http_responses_for_request(
        &self,
        request_id: &str,
        source: &UpdateSource,
    ) -> Result<usize> {
        let responses = self.list_http_responses_for_request(request_id, None)?;
        let count = responses.len();
        for m in responses {
            self.delete(&m, source)?;
        }
        Ok(count)
    }

    /// Returns the number of responses deleted.
    pub fn delete_all_http_responses_for_workspace(
        &self,
        workspace_id: &str,
        source: &UpdateSource,
    ) -> Result<usize> {
        let responses =
            self.find_many::<HttpResponse>(HttpResponseIden::WorkspaceId, workspace_id, None)?;
        let count = responses.len();
        for m in responses {
            self.delete(&m, source)?;
        }
        Ok(count)
    }

    pub fn delete_http_response(
        &self,
        http_response: &HttpResponse,
        source: &UpdateSource,
        blob_manager: &BlobManager,
    ) -> Result<HttpResponse> {
        // Delete the body file if it exists
        if let Some(p) = http_response.body_path.clone() {
            if let Err(e) = fs::remove_file(p) {
                error!("Failed to delete body file: {}", e);
            };
        }

        // Delete request body blobs (pattern: {response_id}.request)
        let body_id = format!("{}.request", http_response.id);
        if let Err(e) = blob_manager.with_tx(|b| b.delete_chunks(&body_id)) {
            error!("Failed to delete request body blobs: {}", e);
        }

        Ok(self.delete(http_response, source)?)
    }

    pub fn upsert_http_response(
        &self,
        http_response: &HttpResponse,
        source: &UpdateSource,
        blob_manager: &BlobManager,
    ) -> Result<HttpResponse> {
        let responses = self.list_http_responses_for_request(&http_response.request_id, None)?;

        for m in responses.iter().skip(MAX_HISTORY_ITEMS - 1) {
            debug!("Deleting old HTTP response {}", http_response.id);
            self.delete_http_response(&m, source, blob_manager)?;
        }

        self.upsert(http_response, source)
    }

    pub fn cancel_pending_http_responses(&self) -> Result<()> {
        let closed = serde_json::to_value(&HttpResponseState::Closed)?;
        let (sql, params) = Query::update()
            .table(HttpResponseIden::Table)
            .values([(HttpResponseIden::State, closed.as_str().into())])
            .cond_where(Expr::col(HttpResponseIden::State).ne(closed.as_str()))
            .build_rusqlite(SqliteQueryBuilder);
        let mut stmt = self.conn().prepare(sql.as_str())?;
        stmt.execute(&*params.as_params())?;
        Ok(())
    }

    pub fn update_http_response_if_id(
        &self,
        response: &HttpResponse,
        source: &UpdateSource,
    ) -> Result<HttpResponse> {
        if response.id.is_empty() { Ok(response.clone()) } else { self.upsert(response, source) }
    }
}

#[cfg(test)]
mod tests {
    use crate::blob_manager::{BlobManager, BodyChunk};
    use crate::error::Error;
    use crate::init_in_memory;
    use crate::models::{HttpRequest, HttpResponse, Workspace};
    use crate::query_manager::QueryManager;
    use crate::util::UpdateSource;

    /// A workspace, a request, and one response that still exists.
    fn seed_live_response(
        query_manager: &QueryManager,
        blob_manager: &BlobManager,
    ) -> HttpResponse {
        let source = &UpdateSource::Background;
        query_manager
            .with_tx(|db| {
                let workspace = db.upsert_workspace(
                    &Workspace { name: "GC Test".to_string(), ..Default::default() },
                    source,
                )?;
                let request = db.upsert_http_request(
                    &HttpRequest { workspace_id: workspace.id.clone(), ..Default::default() },
                    source,
                )?;
                db.upsert_http_response(
                    &HttpResponse {
                        request_id: request.id.clone(),
                        workspace_id: workspace.id.clone(),
                        ..Default::default()
                    },
                    source,
                    blob_manager,
                )
            })
            .expect("Failed to seed response")
    }

    fn insert_bodies(blob_manager: &BlobManager, body_ids: &[&str]) {
        blob_manager
            .with_tx(|b| {
                for id in body_ids {
                    b.insert_chunk(&BodyChunk::new(*id, 0, b"data".to_vec()))?;
                }
                Ok::<_, Error>(())
            })
            .expect("Failed to insert chunks");
    }

    /// What a browser host runs: no filesystem, so bodies exist only as blob
    /// chunks, under both id shapes the blob DB uses.
    #[test]
    fn deletes_orphaned_response_body_blobs() {
        let (query_manager, blob_manager, _rx) = init_in_memory().expect("Failed to init DB");

        let live = seed_live_response(&query_manager, &blob_manager);
        let live_request_body_id = format!("{}.request", live.id);
        insert_bodies(
            &blob_manager,
            &[
                &live.id,
                &live_request_body_id,
                "rs_gone",
                "rs_gone.request",
            ],
        );

        let deleted = query_manager
            .connect()
            .delete_orphaned_response_body_blobs(&blob_manager)
            .expect("Failed to GC response body blobs");
        assert_eq!(deleted, 2);

        let blob_ctx = blob_manager.connect();
        assert!(blob_ctx.body_exists(&live.id).unwrap());
        assert!(blob_ctx.body_exists(&live_request_body_id).unwrap());
        assert!(!blob_ctx.body_exists("rs_gone").unwrap());
        assert!(!blob_ctx.body_exists("rs_gone.request").unwrap());
    }

    #[test]
    fn deletes_orphaned_response_bodies() {
        let (query_manager, blob_manager, _rx) = init_in_memory().expect("Failed to init DB");

        let live = seed_live_response(&query_manager, &blob_manager);
        let live_body_id = format!("{}.request", live.id);
        insert_bodies(&blob_manager, &[&live_body_id, "rs_gone.request"]);

        let dir = std::env::temp_dir().join(format!("yaak-blob-gc-test-{}", live.id));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(&live.id), b"live").unwrap();
        std::fs::write(dir.join("rs_gone"), b"dead").unwrap();

        let deleted = query_manager
            .connect()
            .delete_orphaned_response_bodies(&blob_manager, &dir)
            .expect("Failed to GC response bodies");
        assert_eq!(deleted, 2);

        // Live data survives, orphans are gone
        let blob_ctx = blob_manager.connect();
        assert!(blob_ctx.body_exists(&live_body_id).unwrap());
        assert!(!blob_ctx.body_exists("rs_gone.request").unwrap());
        assert!(dir.join(&live.id).exists());
        assert!(!dir.join("rs_gone").exists());

        std::fs::remove_dir_all(&dir).ok();
    }
}
