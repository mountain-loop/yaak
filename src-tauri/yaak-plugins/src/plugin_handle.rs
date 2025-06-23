use crate::error::Result;
use crate::events::{InternalEvent, InternalEventPayload, PluginWindowContext};
use crate::plugin_meta::{PluginMetadata, get_plugin_meta};
use crate::util::gen_id;
use log::info;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};

#[derive(Clone)]
pub struct PluginHandle {
    pub ref_id: String,
    pub dir: String,
    pub(crate) to_plugin_tx: Arc<Mutex<mpsc::Sender<InternalEvent>>>,
    pub(crate) metadata: PluginMetadata,
}

impl PluginHandle {
    pub fn new(dir: &str, tx: mpsc::Sender<InternalEvent>) -> Result<Self> {
        let ref_id = gen_id();
        let metadata = get_plugin_meta(&Path::new(dir))?;

        Ok(PluginHandle {
            ref_id: ref_id.clone(),
            dir: dir.to_string(),
            to_plugin_tx: Arc::new(Mutex::new(tx)),
            metadata,
        })
    }

    pub fn info(&self) -> PluginMetadata {
        self.metadata.clone()
    }

    pub fn build_event_to_send(
        &self,
        window_context: &PluginWindowContext,
        payload: &InternalEventPayload,
        reply_id: Option<String>,
    ) -> InternalEvent {
        self.build_event_to_send_raw(window_context, payload, reply_id)
    }

    pub(crate) fn build_event_to_send_raw(
        &self,
        window_context: &PluginWindowContext,
        payload: &InternalEventPayload,
        reply_id: Option<String>,
    ) -> InternalEvent {
        let dir = Path::new(&self.dir);
        InternalEvent {
            id: gen_id(),
            plugin_ref_id: self.ref_id.clone(),
            plugin_name: dir.file_name().unwrap().to_str().unwrap().to_string(),
            reply_id,
            payload: payload.clone(),
            window_context: window_context.clone(),
        }
    }

    pub async fn terminate(&self, window_context: &PluginWindowContext) -> Result<()> {
        info!("Terminating plugin {}", self.dir);
        let event =
            self.build_event_to_send(window_context, &InternalEventPayload::TerminateRequest, None);
        self.send(&event).await
    }

    pub async fn send(&self, event: &InternalEvent) -> Result<()> {
        self.to_plugin_tx.lock().await.send(event.to_owned()).await?;
        Ok(())
    }
}
