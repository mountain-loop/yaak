//! What a Yaak host does at fixed points in its life, in one place.
//!
//! The desktop, the browser and the CLI each open the same database and each
//! owe the installation the same upkeep at the same moments — prune the change
//! log, close what the last session left in flight, sweep bodies a cascaded
//! delete orphaned. They run that upkeep on different machinery (a blocking
//! thread here, a deferred macrotask there), so the *what* lives in this crate
//! and only the *when* stays with the host. A new startup task is added here,
//! once, and every host has it.
//!
//! A host describes itself once as a [`Host`]: what it is to the database it
//! opened, and where its things are. Hooks read what they need from that, so
//! upkeep that only makes sense with a filesystem (a responses directory, an
//! installation folder) is a field the browser leaves `None`, not a separate
//! code path per host.
//!
//! This crate builds for wasm32, which is the whole reason it exists apart
//! from `yaak-commands`: it can reach the model layer but not the send engine
//! or the plugin runtime.

use std::path::PathBuf;
use yaak_models::blob_manager::BlobManager;
use yaak_models::client_db::ClientDb;
use yaak_models::error::Result;

/// How long a `model_changes` row lives. The rows exist so a second process
/// (the CLI, another window) can catch up on writes it did not make; an hour
/// is far longer than any poller falls behind.
const MODEL_CHANGES_RETENTION_HOURS: i64 = 1;

/// What this process is to the database it just opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// The one process that has the database for the life of the app: the
    /// desktop, or the browser's SharedWorker. Whatever it finds mid-flight
    /// was left by a session that is over.
    Owner,
    /// A short-lived process on a database an owner may be using at the same
    /// moment: the CLI. A `connected` row it sees may be the desktop's send,
    /// still running, so it must not touch anything in flight.
    Guest,
}

/// The running host, as the hooks need to know it.
///
/// Paths are optional because a browser has none of them; a hook that needs
/// one does nothing when it is absent.
#[derive(Debug, Clone)]
pub struct Host {
    pub role: Role,
    /// Where response body files live, on hosts that keep them on disk.
    pub responses_dir: Option<PathBuf>,
}

impl Host {
    /// A host with the database to itself and nothing on disk.
    pub fn owner() -> Self {
        Self { role: Role::Owner, responses_dir: None }
    }

    /// A short-lived process sharing the database with a possible owner.
    pub fn guest() -> Self {
        Self { role: Role::Guest, responses_dir: None }
    }

    pub fn with_responses_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.responses_dir = Some(dir.into());
        self
    }
}

/// Run once, after migrations and before the host answers its first command
/// or starts polling for changes.
///
/// Cheap and synchronous on purpose: everything here is a handful of UPDATEs
/// and one DELETE, and it has to land before the frontend can read a
/// "pending" row that nothing will ever finish.
pub fn before_serving(host: &Host, db: &ClientDb) -> Result<()> {
    // Safe for anyone: a row older than an hour is behind every poller that
    // could still want it.
    db.prune_model_changes_older_than_hours(MODEL_CHANGES_RETENTION_HOURS)?;

    if host.role == Role::Owner {
        // Anything still marked in-flight was orphaned by the last session; no
        // sender survives a restart.
        db.cancel_pending_http_responses()?;
        db.cancel_pending_grpc_connections()?;
        db.cancel_pending_websocket_connections()?;
    }

    Ok(())
}

/// Run once, whenever an owner has a spare moment after boot — never on the
/// path to first paint, because it scans the whole blob database. Safe next to
/// a running send (the row is written before its body), so a guest *could*
/// run it; a short-lived one just shouldn't pay for the scan on every
/// invocation.
///
/// Sweeps response bodies whose owning row is gone. Cascaded deletes (request,
/// folder, workspace) historically removed the rows through the generic row
/// delete, which never touched the bodies. Blob chunks are swept everywhere;
/// body *files* only where the host has a directory for them.
///
/// Returns how many orphaned bodies were deleted.
pub fn housekeeping(host: &Host, db: &ClientDb, blobs: &BlobManager) -> Result<usize> {
    match host.responses_dir.as_deref() {
        Some(dir) => db.delete_orphaned_response_bodies(blobs, dir),
        None => db.delete_orphaned_response_body_blobs(blobs),
    }
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

        // A guest leaves it alone: it may be another process's live send.
        before_serving(&Host::guest(), &db).unwrap();
        let response = db.get_http_response(&pending.id).unwrap();
        assert!(matches!(response.state, HttpResponseState::Connected));

        // The owner knows nothing survived the restart.
        before_serving(&Host::owner(), &db).unwrap();
        let response = db.get_http_response(&pending.id).unwrap();
        assert!(matches!(response.state, HttpResponseState::Closed));
    }

    #[test]
    fn housekeeping_without_a_filesystem_still_sweeps_blobs() {
        let (query_manager, blob_manager, _rx) = init_in_memory().expect("Failed to init DB");
        let db = query_manager.connect();
        {
            let blob_ctx = blob_manager.connect();
            blob_ctx.insert_chunk(&BodyChunk::new("rs_gone", 0, b"dead".to_vec())).unwrap();
        }

        let deleted = housekeeping(&Host::owner(), &db, &blob_manager).unwrap();

        assert_eq!(deleted, 1);
        assert!(!blob_manager.connect().body_exists("rs_gone").unwrap());
    }
}
