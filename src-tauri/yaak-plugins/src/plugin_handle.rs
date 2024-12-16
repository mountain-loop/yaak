use crate::error::Result;
use crate::events::{BootResponse, InternalEvent, InternalEventPayload, WindowContext};
use crate::server::plugin_runtime::EventStreamEvent;
use crate::util::gen_id;
use log::info;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

#[derive(Clone)]
pub struct PluginHandle {
    pub ref_id: String,
    pub dir: String,
    pub(crate) to_plugin_tx: Arc<Mutex<mpsc::Sender<tonic::Result<EventStreamEvent>>>>,
    pub(crate) boot_resp: Arc<Mutex<BootResponse>>,
}

impl PluginHandle {
    pub fn new(dir: &str, tx: mpsc::Sender<tonic::Result<EventStreamEvent>>) -> Self {
        let ref_id = gen_id();

        PluginHandle {
            ref_id: ref_id.clone(),
            dir: dir.to_string(),
            to_plugin_tx: Arc::new(Mutex::new(tx)),
            boot_resp: Arc::new(Mutex::new(BootResponse::default())),
        }
    }

    pub async fn info(&self) -> BootResponse {
        let resp = &*self.boot_resp.lock().await;
        resp.clone()
    }

    pub fn build_event_to_send(
        &self,
        window_context: WindowContext,
        payload: &InternalEventPayload,
        reply_id: Option<String>,
    ) -> InternalEvent {
        self.build_event_to_send_raw(window_context, payload, reply_id)
    }

    pub(crate) fn build_event_to_send_raw(
        &self,
        window_context: WindowContext,
        payload: &InternalEventPayload,
        reply_id: Option<String>,
    ) -> InternalEvent {
        InternalEvent {
            id: gen_id(),
            plugin_ref_id: self.ref_id.clone(),
            reply_id,
            payload: payload.clone(),
            window_context,
        }
    }

    pub async fn terminate(&self, window_context: WindowContext) -> Result<()> {
        info!("Terminating plugin {}", self.dir);
        let event = self.build_event_to_send(
            window_context,
            &InternalEventPayload::TerminateRequest,
            None,
        );
        self.send(&event).await
    }

    pub(crate) async fn send(&self, event: &InternalEvent) -> Result<()> {
        self.to_plugin_tx
            .lock()
            .await
            .send(Ok(EventStreamEvent {
                event: serde_json::to_string(event)?,
            }))
            .await?;
        Ok(())
    }

    pub async fn set_boot_response(&self, resp: &BootResponse) {
        let mut boot_resp = self.boot_resp.lock().await;
        *boot_resp = resp.clone();
    }
}
