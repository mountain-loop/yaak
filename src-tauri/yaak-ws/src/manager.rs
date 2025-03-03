use crate::connect::ws_connect;
use crate::error::Result;
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use log::debug;
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
    ) -> Result<Response> {
        let (stream, response) = ws_connect(url, headers).await?;
        let (write, mut read) = stream.split();
        self.connections.lock().await.insert(id.to_string(), write);

        let tx = receive_tx.clone();
        tauri::async_runtime::spawn({
            let connections = self.connections.clone();
            let connection_id = id.to_string();
            async move {
                while let Some(msg) = read.next().await {
                    match msg {
                        Err(_e) => {
                            // broken connection
                            tx.send(Message::Close(None)).await.unwrap();
                            break;
                        }
                        Ok(message) => {
                            tx.send(message).await.unwrap();
                        }
                    }
                }
                // cleanup
                connections.lock().await.remove(&connection_id);
                debug!("Connection {connection_id} closed");
            }
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
}
