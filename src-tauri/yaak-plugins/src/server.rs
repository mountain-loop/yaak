use log::warn;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tonic::codegen::tokio_stream::wrappers::ReceiverStream;
use tonic::codegen::tokio_stream::{Stream, StreamExt};
use tonic::{Request, Response, Status, Streaming};

use crate::events::InternalEvent;
use crate::server::plugin_runtime::plugin_runtime_server::PluginRuntime;
use plugin_runtime::EventStreamEvent;

pub mod plugin_runtime {
    tonic::include_proto!("yaak.plugins.runtime");
}

type ResponseStream = Pin<Box<dyn Stream<Item = Result<EventStreamEvent, Status>> + Send>>;

#[derive(Clone)]
pub(crate) struct PluginRuntimeServerImpl {
    pub(crate) app_to_plugin_events_tx:
        Arc<Mutex<Option<mpsc::Sender<tonic::Result<EventStreamEvent>>>>>,
    client_disconnect_tx: mpsc::Sender<bool>,
    client_connect_tx: tokio::sync::watch::Sender<bool>,
    plugin_to_app_events_tx: mpsc::Sender<InternalEvent>,
}

impl PluginRuntimeServerImpl {
    pub fn new(
        events_tx: mpsc::Sender<InternalEvent>,
        disconnect_tx: mpsc::Sender<bool>,
        connect_tx: tokio::sync::watch::Sender<bool>,
    ) -> Self {
        PluginRuntimeServerImpl {
            app_to_plugin_events_tx: Arc::new(Mutex::new(None)),
            client_disconnect_tx: disconnect_tx,
            client_connect_tx: connect_tx,
            plugin_to_app_events_tx: events_tx,
        }
    }
}

#[tonic::async_trait]
impl PluginRuntime for PluginRuntimeServerImpl {
    type EventStreamStream = ResponseStream;

    async fn event_stream(
        &self,
        req: Request<Streaming<EventStreamEvent>>,
    ) -> tonic::Result<Response<Self::EventStreamStream>> {
        let mut in_stream = req.into_inner();

        let (to_plugin_tx, to_plugin_rx) = mpsc::channel::<tonic::Result<EventStreamEvent>>(128);
        let mut app_to_plugin_events_tx = self.app_to_plugin_events_tx.lock().await;
        *app_to_plugin_events_tx = Some(to_plugin_tx);

        let plugin_to_app_events_tx = self.plugin_to_app_events_tx.clone();
        let client_disconnect_tx = self.client_disconnect_tx.clone();

        self.client_connect_tx.send(true).expect("Failed to send client ready event");

        tokio::spawn(async move {
            while let Some(result) = in_stream.next().await {
                // Received event from plugin runtime
                match result {
                    Ok(v) => {
                        let event: InternalEvent = match serde_json::from_str(v.event.as_str()) {
                            Ok(pe) => pe,
                            Err(e) => {
                                warn!("Failed to deserialize event {e:?} -> {}", v.event);
                                continue;
                            }
                        };

                        // Send event to subscribers
                        // Emit event to the channel for server to handle
                        if let Err(e) = plugin_to_app_events_tx.try_send(event.clone()) {
                            warn!("Failed to send to channel. Receiver probably isn't listening: {:?}", e);
                        }
                    }
                    Err(err) => {
                        // TODO: Better error handling
                        warn!("gRPC server error {err}");
                        break;
                    }
                };
            }

            if let Err(e) = client_disconnect_tx.send(true).await {
                warn!("Failed to send killed event {:?}", e);
            }
        });

        // Write the same data that was received
        let out_stream = ReceiverStream::new(to_plugin_rx);

        Ok(Response::new(Box::pin(out_stream) as Self::EventStreamStream))
    }
}
