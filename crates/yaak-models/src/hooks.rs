//! What a host does at fixed points in its life, in one place.
//!
//! The desktop, the browser and the CLI all open the same database and then
//! owe it the same upkeep: prune the change log, close whatever was left
//! mid-flight by the last session, sweep bodies that a cascaded delete
//! orphaned. They run that upkeep on different machinery — a blocking thread
//! here, a deferred macrotask there — so the *what* lives in this module and
//! only the *when* stays with the host. A new startup task is added here,
//! once, and every host has it.
//!
//! The one distinction that matters is [`Role`]: whether this process owns the
//! database for as long as it runs, or is a guest on one that another process
//! may be using right now. Some upkeep is only correct for an owner.

use crate::blob_manager::BlobManager;
use crate::client_db::ClientDb;
use crate::error::Result;
use std::path::Path;

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

/// Run once, after migrations and before the host answers its first command
/// or starts polling for changes.
///
/// Cheap and synchronous on purpose: everything here is a handful of UPDATEs
/// and one DELETE, and it has to land before the frontend can read a
/// "pending" row that nothing will ever finish.
pub fn before_serving(db: &ClientDb, role: Role) -> Result<()> {
    // Safe for anyone: a row older than an hour is behind every poller that
    // could still want it.
    db.prune_model_changes_older_than_hours(MODEL_CHANGES_RETENTION_HOURS)?;

    if role == Role::Owner {
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
/// body *files* only where there is a filesystem to hold them, which is what
/// `responses_dir` says.
///
/// Returns how many orphaned bodies were deleted.
pub fn housekeeping(
    db: &ClientDb,
    blobs: &BlobManager,
    responses_dir: Option<&Path>,
) -> Result<usize> {
    match responses_dir {
        Some(dir) => db.delete_orphaned_response_bodies(blobs, dir),
        None => db.delete_orphaned_response_body_blobs(blobs),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blob_manager::BodyChunk;
    use crate::init_in_memory;
    use crate::models::{HttpRequest, HttpResponse, HttpResponseState, Workspace};
    use crate::util::UpdateSource;

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
        before_serving(&db, Role::Guest).unwrap();
        let response = db.get_http_response(&pending.id).unwrap();
        assert!(matches!(response.state, HttpResponseState::Connected));

        // The owner knows nothing survived the restart.
        before_serving(&db, Role::Owner).unwrap();
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

        let deleted = housekeeping(&db, &blob_manager, None).unwrap();

        assert_eq!(deleted, 1);
        assert!(!blob_manager.connect().body_exists("rs_gone").unwrap());
    }
}
