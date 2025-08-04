use log::info;
use std::sync::Arc;
use tauri::http::HeaderMap;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Response;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::{
    Connector, MaybeTlsStream, WebSocketStream, connect_async_tls_with_config,
};

// Enabling ALPN breaks websocket requests
const WITH_ALPN: bool = false;

pub(crate) async fn ws_connect(
    url: &str,
    headers: HeaderMap<HeaderValue>,
    validate_certificates: bool,
) -> crate::error::Result<(WebSocketStream<MaybeTlsStream<TcpStream>>, Response)> {
    info!("Connecting to WS {url}");
    let tls_config = yaak_http::tls::get_config(validate_certificates, WITH_ALPN);

    let mut req = url.into_client_request()?;
    let req_headers = req.headers_mut();
    for (name, value) in headers {
        if let Some(name) = name {
            req_headers.insert(name, value);
        }
    }

    let (stream, response) = connect_async_tls_with_config(
        req,
        Some(WebSocketConfig::default()),
        false,
        Some(Connector::Rustls(Arc::new(tls_config))),
    )
    .await?;
    Ok((stream, response))
}
