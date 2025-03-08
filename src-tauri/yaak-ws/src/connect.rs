use log::info;
use rustls::crypto::ring;
use rustls::ClientConfig;
use rustls_platform_verifier::BuilderVerifierExt;
use std::sync::Arc;
use tauri::http::HeaderMap;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Response;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::{
    connect_async_tls_with_config, Connector, MaybeTlsStream, WebSocketStream,
};

pub(crate) async fn ws_connect(
    url: &str,
    headers: HeaderMap<HeaderValue>,
) -> crate::error::Result<(WebSocketStream<MaybeTlsStream<TcpStream>>, Response)> {
    info!("Connecting to WS {url}");
    let arc_crypto_provider = Arc::new(ring::default_provider());
    let config = ClientConfig::builder_with_provider(arc_crypto_provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_platform_verifier()
        .with_no_client_auth();

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
        Some(Connector::Rustls(Arc::new(config))),
    )
    .await?;
    Ok((stream, response))
}