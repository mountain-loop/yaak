use crate::connect::ws_connect;
use crate::error::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Runtime};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::handshake::client::Response;
use tokio_tungstenite::tungstenite::http::{HeaderMap, HeaderValue};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

#[derive(Clone)]
pub struct WebsocketManager<R: Runtime> {
    app_handle: AppHandle<R>,
    connections: Arc<Mutex<HashMap<String, WebSocketStream<MaybeTlsStream<TcpStream>>>>>,
}

impl<R: Runtime> WebsocketManager<R> {
    pub fn new(app_handle: &AppHandle<R>) -> Self {
        WebsocketManager {
            app_handle: app_handle.clone(),
            connections: Default::default(),
        }
    }

    pub async fn connect(
        &mut self,
        id: &str,
        url: &str,
        headers: HeaderMap<HeaderValue>,
    ) -> Result<Response> {
        let (stream, response) = ws_connect(url, headers).await?;
        self.connections.lock().await.insert(id.to_string(), stream);
        Ok(response)
    }

    pub async fn cancel(&mut self, id: &str) -> Result<()> {
        let mut connections = self.connections.lock().await;
        let connection = match connections.get_mut(id) {
            None => return Ok(()),
            Some(c) => c
        };
        connection.close(None).await?;
        Ok(())
    }
}
