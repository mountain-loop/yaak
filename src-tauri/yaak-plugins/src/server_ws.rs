use crate::events::InternalEvent;
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_async, accept_async_with_config};

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

                        let event = match serde_json::from_str::<InternalEvent>(&msg.into_text().unwrap()) {
                            Ok(e) => e,
                            Err(e) => {
                                warn!("Failed to decode plugin event {e:?}");
                                continue;
                            }
                        };

                        println!("-------- WS RECEIVE {event:?}");

                        // Send event to subscribers
                        // Emit event to the channel for server to handle
                        if let Err(e) = plugin_to_app_events_tx.try_send(event.clone()) {
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
                                println!("-------- WS SENDING {event:?}");
                                let event_bytes = serde_json::to_string(&event).unwrap();
                                let msg = Message::text(event_bytes);
                                ws_sender.send(msg).await.unwrap();
                                println!("-------- WS SENDING {event:?}");
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
