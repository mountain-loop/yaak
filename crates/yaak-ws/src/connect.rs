use crate::error::Result;
use http::HeaderMap;
use log::info;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Response;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::{
    Connector, MaybeTlsStream, WebSocketStream, connect_async_tls_with_config,
};
use yaak_tls::{ClientCertificateConfig, get_tls_config};

// Enabling ALPN breaks websocket requests
const WITH_ALPN: bool = false;

pub async fn ws_connect(
    url: &str,
    headers: HeaderMap<HeaderValue>,
    validate_certificates: bool,
    client_cert: Option<ClientCertificateConfig>,
) -> Result<(WebSocketStream<MaybeTlsStream<TcpStream>>, Response)> {
    info!("Connecting to WS {url}");
    let tls_config = get_tls_config(validate_certificates, WITH_ALPN, client_cert.clone())?;

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

    info!(
        "Connected to WS {url} validate_certificates={} client_cert={}",
        validate_certificates,
        client_cert.is_some()
    );

    Ok((stream, response))
}
