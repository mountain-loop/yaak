use crate::connect::ws_connect;
use crate::error::Result;
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use log::{debug, info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::{Mutex, mpsc};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::client::Response;
use http::HeaderMap;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use yaak_tls::ClientCertificateConfig;

#[derive(Clone)]
pub struct WebsocketManager {
    connections:
        Arc<Mutex<HashMap<String, SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>>>>,
    read_tasks: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
}

impl WebsocketManager {
    pub fn new() -> Self {
        WebsocketManager { connections: Default::default(), read_tasks: Default::default() }
    }

    pub async fn connect(
        &mut self,
        id: &str,
        url: &str,
        headers: HeaderMap<HeaderValue>,
        receive_tx: mpsc::Sender<Message>,
        validate_certificates: bool,
        client_cert: Option<ClientCertificateConfig>,
    ) -> Result<Response> {
        let tx = receive_tx.clone();

        let (stream, response) =
            ws_connect(url, headers, validate_certificates, client_cert).await?;
        let (write, mut read) = stream.split();

        self.connections.lock().await.insert(id.to_string(), write);

        let handle = {
            let connection_id = id.to_string();
            let connections = self.connections.clone();
            let read_tasks = self.read_tasks.clone();
            tokio::task::spawn(async move {
                while let Some(msg) = read.next().await {
                    match msg {
                        Err(e) => {
                            warn!("Broken websocket connection: {}", e);
                            break;
                        }
                        Ok(message) => tx.send(message).await.unwrap(),
                    }
                }
                debug!("Connection {} closed", connection_id);
                connections.lock().await.remove(&connection_id);
                read_tasks.lock().await.remove(&connection_id);
            })
        };

        self.read_tasks.lock().await.insert(id.to_string(), handle);

        Ok(response)
    }

    pub async fn send(&mut self, id: &str, msg: Message) -> Result<()> {
        debug!("Send websocket message {msg:?}");
        let mut connections = self.connections.lock().await;
        let connection = match connections.get_mut(id) {
            None => return Ok(()),
            Some(c) => c,
        };
        connection.send(msg).await?;
        Ok(())
    }

    pub async fn close(&mut self, id: &str) -> Result<()> {
        info!("Closing websocket");
        if let Some(mut connection) = self.connections.lock().await.remove(id) {
            // Wait a maximum of 1 second for the connection to close
            if let Err(e) = connection.close().await {
                warn!("Failed to close websocket connection {e:?}");
            };
        }

        // Wait at short time for the server to close the connection, then stop
        // reading.
        tokio::time::sleep(Duration::from_millis(500)).await;
        if let Some(handle) = self.read_tasks.lock().await.remove(id) {
            handle.abort();
        }

        Ok(())
    }
}
