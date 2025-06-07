use crate::connect::ws_connect;
use crate::error::Result;
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use log::{debug, warn};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::handshake::client::Response;
use tokio_tungstenite::tungstenite::http::{HeaderMap, HeaderValue};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

#[derive(Clone)]
pub struct WebsocketManager {
    connections:
        Arc<Mutex<HashMap<String, SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>>>>,
}

impl WebsocketManager {
    pub fn new() -> Self {
        WebsocketManager {
            connections: Default::default(),
        }
    }

    pub async fn connect(
        &mut self,
        id: &str,
        url: &str,
        headers: HeaderMap<HeaderValue>,
        receive_tx: mpsc::Sender<Message>,
        validate_certificates: bool,
    ) -> Result<Response> {
        let connections = self.connections.clone();
        let connection_id = id.to_string();
        let tx = receive_tx.clone();

        let (stream, response) = ws_connect(url, headers, validate_certificates).await?;
        let (write, mut read) = stream.split();

        connections.lock().await.insert(id.to_string(), write);

        tauri::async_runtime::spawn(async move {
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
        });
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
        debug!("Closing websocket");
        let mut connections = self.connections.lock().await;
        let connection = match connections.get_mut(id) {
            None => return Ok(()),
            Some(c) => c,
        };
        connection.close().await?;
        Ok(())
    }
}
