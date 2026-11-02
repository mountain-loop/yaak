use std::sync::Arc;

use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto;
use tokio::io::{AsyncRead, AsyncWrite};

use crate::request::handle_request;
use crate::{ClientConn, Engine};

/// Streams one HTTP/2 client connection may have open at once.
const MAX_CONCURRENT_STREAMS: u32 = 100;
/// What an HTTP/2 client may send before the engine has forwarded it, per stream and in all.
/// The same as hyper's client uses upstream, so uploads are not throttled in between.
const STREAM_WINDOW: u32 = 2 * 1024 * 1024;
const CONNECTION_WINDOW: u32 = 5 * 1024 * 1024;
/// Request headers an HTTP/2 client may send, cookies included. hyper's 16 KB default is less
/// than a browser sends some sites.
const MAX_HEADER_LIST_SIZE: u32 = 256 * 1024;

/// Serves a decrypted client connection in the protocol it chose in ALPN: HTTP/2, with each
/// stream a request of its own, or HTTP/1.1 as on the plain listener.
pub(crate) async fn serve_tls<S, F, Fut>(
    io: S,
    http2: bool,
    handler: F,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    F: Fn(hyper::Request<hyper::body::Incoming>) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<hyper::Response<crate::request::BoxBody>, std::convert::Infallible>>
        + Send
        + 'static,
{
    let mut builder = auto::Builder::new(TokioExecutor::new());
    builder.http1().preserve_header_case(true).title_case_headers(true);
    builder
        .http2()
        .max_concurrent_streams(MAX_CONCURRENT_STREAMS)
        .initial_stream_window_size(STREAM_WINDOW)
        .initial_connection_window_size(CONNECTION_WINDOW)
        .max_header_list_size(MAX_HEADER_LIST_SIZE);
    let builder = if http2 { builder.http2_only() } else { builder.http1_only() };
    builder.serve_connection_with_upgrades(TokioIo::new(io), service_fn(handler)).await
}

/// Serves a connection to the listener, in HTTP/1.1 only: HTTP/2 is offered inside TLS alone.
pub(crate) async fn handle_connection(
    stream: tokio::net::TcpStream,
    client: ClientConn,
    engine: Arc<Engine>,
) -> Result<(), hyper::Error> {
    http1::Builder::new()
        .preserve_header_case(true)
        .title_case_headers(true)
        .serve_connection(
            TokioIo::new(stream),
            service_fn(move |req| handle_request(req, client, engine.clone())),
        )
        .with_upgrades()
        .await
}
