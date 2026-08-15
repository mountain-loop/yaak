//! The events channel: everything the browser tab would have received as a
//! Tauri window event.
//!
//! Two directions ride the same WebSocket. Server to client is a broadcast, so
//! `model_writes`, `stream_{id}` messages, toasts and plugin events all reach
//! the tab through one pipe. Client to server exists because some plugin host
//! requests are questions — a prompt round-trips through the UI and comes back
//! keyed by the originating event's id, exactly as the desktop app's
//! `call_frontend` does with window events.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, mpsc};

/// One frame in either direction: a name and a JSON payload.
///
/// Deliberately the same shape both ways, and the same shape as the desktop's
/// event payloads, so `platform.listen` on the browser side hands the payload
/// to callers unwrapped.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventFrame {
    pub event: String,
    #[serde(default)]
    pub payload: serde_json::Value,
}

#[derive(Clone)]
pub struct EventHub {
    outbound: broadcast::Sender<EventFrame>,
    /// Listeners waiting on a named event from the client, keyed by event name.
    inbound: Arc<Mutex<HashMap<String, Vec<mpsc::UnboundedSender<serde_json::Value>>>>>,
}

/// A subscription to one named client-sent event. Deregisters on drop, so a
/// prompt that is never answered doesn't leak a listener for the process's life.
pub struct InboundSubscription {
    event: String,
    rx: mpsc::UnboundedReceiver<serde_json::Value>,
    inbound: Arc<Mutex<HashMap<String, Vec<mpsc::UnboundedSender<serde_json::Value>>>>>,
}

impl InboundSubscription {
    pub async fn recv(&mut self) -> Option<serde_json::Value> {
        self.rx.recv().await
    }
}

impl Drop for InboundSubscription {
    fn drop(&mut self) {
        let mut inbound = match self.inbound.lock() {
            Ok(inbound) => inbound,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(senders) = inbound.get_mut(&self.event) {
            senders.retain(|tx| !tx.is_closed());
            if senders.is_empty() {
                inbound.remove(&self.event);
            }
        }
    }
}

impl EventHub {
    pub fn new() -> Self {
        // Bounded: a tab that stops reading gets dropped frames rather than
        // growing the server's memory without limit. Model writes are the
        // high-volume case (imports, bulk deletes) and they arrive in batches.
        let (outbound, _) = broadcast::channel(1024);
        Self { outbound, inbound: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// Send an event to every connected tab. Fails silently when none is
    /// connected, which is the normal state before a browser attaches.
    pub fn emit<T: Serialize>(&self, event: impl Into<String>, payload: &T) {
        let payload = match serde_json::to_value(payload) {
            Ok(payload) => payload,
            Err(e) => {
                log::warn!("Failed to serialize event payload: {e}");
                return;
            }
        };
        let _ = self.outbound.send(EventFrame { event: event.into(), payload });
    }

    pub fn subscribe(&self) -> broadcast::Receiver<EventFrame> {
        self.outbound.subscribe()
    }

    /// Listen for a named event sent *by* the client.
    pub fn subscribe_inbound(&self, event: impl Into<String>) -> InboundSubscription {
        let event = event.into();
        let (tx, rx) = mpsc::unbounded_channel();
        let mut inbound = match self.inbound.lock() {
            Ok(inbound) => inbound,
            Err(poisoned) => poisoned.into_inner(),
        };
        inbound.entry(event.clone()).or_default().push(tx);
        drop(inbound);
        InboundSubscription { event, rx, inbound: Arc::clone(&self.inbound) }
    }

    /// Route a frame that arrived from a tab to whoever is waiting on it.
    pub fn dispatch_inbound(&self, frame: EventFrame) {
        let mut inbound = match self.inbound.lock() {
            Ok(inbound) => inbound,
            Err(poisoned) => poisoned.into_inner(),
        };
        let Some(senders) = inbound.get_mut(&frame.event) else {
            return;
        };
        senders.retain(|tx| tx.send(frame.payload.clone()).is_ok());
        if senders.is_empty() {
            inbound.remove(&frame.event);
        }
    }
}
