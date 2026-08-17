//! Lifecycle hooks shared by every host (desktop, browser, CLI). The hooks say
//! what happens at each moment; the host decides when and on which thread.
//!
//! Builds for wasm32, so it can depend on `yaak-models` but not on the send
//! engine or plugin runtime.

use log::info;
use std::path::PathBuf;
use yaak_models::blob_manager::BlobManager;
use yaak_models::client_db::ClientDb;
use yaak_models::error::Result;

const MODEL_CHANGES_RETENTION_HOURS: i64 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Has the database for the life of the app (desktop, browser worker)
    Owner,
    /// Short-lived, and an owner may be using the database right now (CLI).
    /// Must not touch anything in flight.
    Guest,
}

/// Paths are `None` on hosts without a filesystem (the browser).
#[derive(Debug, Clone)]
pub struct Host {
    pub role: Role,
    pub responses_dir: Option<PathBuf>,
}

impl Host {
    pub fn owner() -> Self {
        Self { role: Role::Owner, responses_dir: None }
    }

    pub fn guest() -> Self {
        Self { role: Role::Guest, responses_dir: None }
    }

    pub fn with_responses_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.responses_dir = Some(dir.into());
        self
    }
}

/// Run once after the database is open, before the host answers anything.
pub fn on_launch(host: &Host, db: &ClientDb, blobs: &BlobManager) -> Result<()> {
    db.prune_model_changes_older_than_hours(MODEL_CHANGES_RETENTION_HOURS)?;

    if host.role == Role::Owner {
        // Anything still in flight was left by the last session
        db.cancel_pending_http_responses()?;
        db.cancel_pending_grpc_connections()?;
        db.cancel_pending_websocket_connections()?;

        // Cascaded deletes never cleaned up response bodies
        let deleted = match host.responses_dir.as_deref() {
            Some(dir) => db.delete_orphaned_response_bodies(blobs, dir)?,
            None => db.delete_orphaned_response_body_blobs(blobs)?,
        };
        if deleted > 0 {
            info!("Deleted {deleted} orphaned response bodies");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use yaak_models::blob_manager::BodyChunk;
    use yaak_models::init_in_memory;
    use yaak_models::models::{HttpRequest, HttpResponse, HttpResponseState, Workspace};
    use yaak_models::util::UpdateSource;

    #[test]
    fn only_the_owner_closes_what_the_last_session_left_open() {
        let (query_manager, blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        let source = &UpdateSource::Background;

        let workspace = db
            .upsert_workspace(
                &Workspace { name: "Hooks".to_string(), ..Default::default() },
                source,
            )
            .unwrap();
        let request = db
            .upsert_http_request(
                &HttpRequest { workspace_id: workspace.id.clone(), ..Default::default() },
                source,
            )
            .unwrap();
        let pending = db
            .upsert_http_response(
                &HttpResponse {
                    request_id: request.id.clone(),
                    workspace_id: workspace.id.clone(),
                    state: HttpResponseState::Connected,
                    ..Default::default()
                },
                source,
                &blob_manager,
            )
            .unwrap();

        on_launch(&Host::guest(), &db, &blob_manager).unwrap();
        let response = db.get_http_response(&pending.id).unwrap();
        assert!(matches!(response.state, HttpResponseState::Connected));

        on_launch(&Host::owner(), &db, &blob_manager).unwrap();
        let response = db.get_http_response(&pending.id).unwrap();
        assert!(matches!(response.state, HttpResponseState::Closed));
    }

    #[test]
    fn owner_without_a_filesystem_still_sweeps_blobs() {
        let (query_manager, blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        {
            let blob_ctx = blob_manager.connect();
            blob_ctx.insert_chunk(&BodyChunk::new("rs_gone", 0, b"dead".to_vec())).unwrap();
        }

        on_launch(&Host::owner(), &db, &blob_manager).unwrap();

        assert!(!blob_manager.connect().body_exists("rs_gone").unwrap());
    }
}
