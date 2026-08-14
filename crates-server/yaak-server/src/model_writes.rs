//! Pushing model writes to the connected tab.
//!
//! A direct port of the desktop's two paths (see
//! crates-tauri/yaak-app-client/src/models_ext.rs), and for the same reason:
//! the in-memory channel is the fast path for writes this process made on a
//! client's behalf, while polling the `model_changes` table is what makes an
//! external writer — the CLI, a second bridge, the desktop app open on the same
//! database — show up live in the browser. Keeping both means the browser
//! behaves like the desktop rather than like a cache.

use crate::events::EventHub;
use chrono::Utc;
use log::error;
use std::sync::mpsc::Receiver;
use std::time::Duration;
use yaak_models::query_manager::QueryManager;
use yaak_models::util::{ModelPayload, UpdateSource};

const MODEL_CHANGES_RETENTION_HOURS: i64 = 1;
const MODEL_CHANGES_POLL_INTERVAL_MS: u64 = 1000;
const MODEL_CHANGES_POLL_BATCH_SIZE: usize = 200;

struct ModelChangeCursor {
    created_at: String,
    id: i64,
}

impl ModelChangeCursor {
    fn from_launch_time() -> Self {
        Self {
            created_at: Utc::now().naive_utc().format("%Y-%m-%d %H:%M:%S%.3f").to_string(),
            id: 0,
        }
    }
}

pub fn start(query_manager: &QueryManager, rx: Receiver<ModelPayload>, events: EventHub) {
    if let Err(err) =
        query_manager.connect().prune_model_changes_older_than_hours(MODEL_CHANGES_RETENTION_HOURS)
    {
        error!("Failed to prune model_changes rows on startup: {err:?}");
    }

    // Only stream writes that happen after this process started.
    let cursor = ModelChangeCursor::from_launch_time();
    let poll_query_manager = query_manager.clone();
    let poll_events = events.clone();
    tokio::spawn(async move {
        run_model_change_poller(poll_query_manager, poll_events, cursor).await;
    });

    // `init_standalone` hands back a std (blocking) receiver, so it gets a
    // thread rather than a task.
    std::thread::spawn(move || {
        while let Ok(payload) = rx.recv() {
            let mut batch: Vec<ModelPayload> = Vec::new();
            if matches!(payload.update_source, UpdateSource::Window { .. }) {
                batch.push(payload);
            }
            // Coalesce anything already queued into the same frame.
            while let Ok(next) = rx.try_recv() {
                if matches!(next.update_source, UpdateSource::Window { .. }) {
                    batch.push(next);
                }
            }
            if batch.is_empty() {
                continue;
            }
            events.emit("model_writes", &batch);
        }
    });
}

async fn run_model_change_poller(
    query_manager: QueryManager,
    events: EventHub,
    mut cursor: ModelChangeCursor,
) {
    loop {
        while drain_model_changes_batch(&query_manager, &events, &mut cursor) {}
        tokio::time::sleep(Duration::from_millis(MODEL_CHANGES_POLL_INTERVAL_MS)).await;
    }
}

fn drain_model_changes_batch(
    query_manager: &QueryManager,
    events: &EventHub,
    cursor: &mut ModelChangeCursor,
) -> bool {
    let changes = match query_manager.connect().list_model_changes_since(
        &cursor.created_at,
        cursor.id,
        MODEL_CHANGES_POLL_BATCH_SIZE,
    ) {
        Ok(changes) => changes,
        Err(err) => {
            error!("Failed to poll model_changes rows: {err:?}");
            return false;
        }
    };

    if changes.is_empty() {
        return false;
    }

    let fetched_count = changes.len();
    let mut batch: Vec<ModelPayload> = Vec::with_capacity(fetched_count);
    for change in changes {
        cursor.created_at = change.created_at;
        cursor.id = change.id;

        // Window-sourced writes already went out on the in-memory fast path.
        if matches!(change.payload.update_source, UpdateSource::Window { .. }) {
            continue;
        }
        batch.push(change.payload);
    }

    // One batch per drain so bulk writes don't flood the tab.
    if !batch.is_empty() {
        events.emit("model_writes", &batch);
    }

    fetched_count == MODEL_CHANGES_POLL_BATCH_SIZE
}
