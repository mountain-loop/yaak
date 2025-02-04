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

#[cfg(test)]
mod tests {
    use crate::connect::ws_connect;
    use crate::error::Result;
    use futures_util::{SinkExt, StreamExt};
    use std::time::Duration;
    use tokio::time::timeout;
    use tokio_tungstenite::tungstenite::Message;

    #[tokio::test]
    async fn test_connection() -> Result<()> {
        let (stream, response) = ws_connect("wss://echo.websocket.org/", Default::default()).await?;
        assert_eq!(response.status(), 101);

        let (mut write, mut read) = stream.split();

        let task = tokio::spawn(async move {
            while let Some(Ok(message)) = read.next().await {
                if message.is_text() && message.to_text().unwrap() == "Hello" {
                    return message;
                }
            }
            panic!("Didn't receive text message");
        });

        write.send(Message::Text("Hello".into())).await?;

        let task = timeout(Duration::from_secs(3), task);
        let message = task.await.unwrap().unwrap();

        assert_eq!(message.into_text().unwrap(), "Hello");

        Ok(())
    }
}
