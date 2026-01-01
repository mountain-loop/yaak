use crate::events::{ErrorResponse, InternalEvent, InternalEventPayload, InternalEventRawPayload};
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, mpsc};
use tokio_tungstenite::accept_async_with_config;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;

#[derive(Clone)]
pub(crate) struct PluginRuntimeServerWebsocket {
    pub(crate) app_to_plugin_events_tx: Arc<Mutex<Option<mpsc::Sender<InternalEvent>>>>,
    client_disconnect_tx: mpsc::Sender<bool>,
    client_connect_tx: tokio::sync::watch::Sender<bool>,
    plugin_to_app_events_tx: mpsc::Sender<InternalEvent>,
}

impl PluginRuntimeServerWebsocket {
    pub fn new(
        events_tx: mpsc::Sender<InternalEvent>,
        disconnect_tx: mpsc::Sender<bool>,
        connect_tx: tokio::sync::watch::Sender<bool>,
    ) -> Self {
        PluginRuntimeServerWebsocket {
            app_to_plugin_events_tx: Arc::new(Mutex::new(None)),
            client_disconnect_tx: disconnect_tx,
            client_connect_tx: connect_tx,
            plugin_to_app_events_tx: events_tx,
        }
    }

    pub async fn listen(&self, listener: TcpListener) {
        while let Ok((stream, _)) = listener.accept().await {
            self.accept_connection(stream).await;
        }
    }

    async fn accept_connection(&self, stream: TcpStream) {
        let (to_plugin_tx, mut to_plugin_rx) = mpsc::channel::<InternalEvent>(128);
        let mut app_to_plugin_events_tx = self.app_to_plugin_events_tx.lock().await;
        *app_to_plugin_events_tx = Some(to_plugin_tx);

        let plugin_to_app_events_tx = self.plugin_to_app_events_tx.clone();
        let client_disconnect_tx = self.client_disconnect_tx.clone();
        let client_connect_tx = self.client_connect_tx.clone();

        let addr = stream.peer_addr().expect("connected streams should have a peer address");

        let conf = WebSocketConfig::default();
        let ws_stream = accept_async_with_config(stream, Some(conf))
            .await
            .expect("Error during the websocket handshake occurred");

        let (mut ws_sender, mut ws_receiver) = ws_stream.split();

        tauri::async_runtime::spawn(async move {
            client_connect_tx.send(true).expect("Failed to send client ready event");

            info!("New plugin runtime websocket connection: {}", addr);

            loop {
                tokio::select! {
                    msg = ws_receiver.next() => {
                        let msg = match msg {
                            Some(Ok(msg)) => msg,
                            Some(Err(e)) => {
                                warn!("Websocket error {e:?}");
                                continue;
                            }
                            None => break,
                        };

                        // Skip non-text messages
                        if !msg.is_text() {
                            warn!("Received non-text message from plugin runtime");
                            continue;
                        }

                        let msg_text = match msg.into_text() {
                            Ok(text) => text,
                            Err(e) => {
                                error!("Failed to convert message to text: {e:?}");
                                continue;
                            }
                        };
                        let event = match serde_json::from_str::<InternalEventRawPayload>(&msg_text) {
                            Ok(e) => e,
                            Err(e) => {
                                error!("Failed to decode plugin event {e:?} -> {msg_text}");
                                continue;
                            }
                        };

                        // Parse everything but the payload so we can catch errors on that, specifically
                        let payload = serde_json::from_value::<InternalEventPayload>(event.payload.clone())
                            .unwrap_or_else(|e| {
                                warn!("Plugin event parse error from {}: {:?} {}", event.plugin_name, e, event.payload);
                                InternalEventPayload::ErrorResponse(ErrorResponse {
                                    error: format!("Plugin event parse error from {}: {e:?}", event.plugin_name),
                                })
                            });

                        let event = InternalEvent{
                            id: event.id,
                            payload,
                            plugin_ref_id: event.plugin_ref_id,
                            plugin_name: event.plugin_name,
                            context: event.context,
                            reply_id: event.reply_id,
                        };

                        // Send event to subscribers
                        // Emit event to the channel for server to handle
                        if let Err(e) = plugin_to_app_events_tx.try_send(event) {
                            warn!("Failed to send to channel. Receiver probably isn't listening: {:?}", e);
                        }
                    }

                    event_for_plugin = to_plugin_rx.recv() => {
                        match event_for_plugin {
                            None => {
                                error!("Plugin runtime client WS channel closed");
                                return;
                            },
                            Some(event) => {
                                let event_bytes = match serde_json::to_string(&event) {
                                    Ok(bytes) => bytes,
                                    Err(e) => {
                                        error!("Failed to serialize event: {:?}", e);
                                        continue;
                                    }
                                };
                                let msg = Message::text(event_bytes);
                                if let Err(e) = ws_sender.send(msg).await {
                                    error!("Failed to send message to plugin runtime: {:?}", e);
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            if let Err(e) = client_disconnect_tx.send(true).await {
                warn!("Failed to send killed event {:?}", e);
            }
        });
    }
}
