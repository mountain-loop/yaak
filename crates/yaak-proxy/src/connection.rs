use std::error::Error;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::{Context, Poll};

use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto;
use log::debug;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;

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
) -> Result<(), Box<dyn Error + Send + Sync>>
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
    stream: TcpStream,
    client: ClientConn,
    engine: Arc<Engine>,
) -> Result<(), hyper::Error> {
    let reset = ResetHandle::default();
    let io = ClientIo { tcp: stream, reset: reset.clone() };
    let served = http1::Builder::new()
        .preserve_header_case(true)
        .title_case_headers(true)
        .serve_connection(
            TokioIo::new(io),
            service_fn(move |req| handle_request(req, client, engine.clone(), reset.clone())),
        )
        .with_upgrades()
        .await;
    match served {
        // Reset as the request service asked, which said why.
        Err(e) if e.source().is_some_and(|e| e.is::<Reset>()) => Ok(()),
        served => served,
    }
}

/// Lets a request service reset the client connection it serves, so the client reports a
/// connection error of its own rather than a response.
#[derive(Clone, Default)]
pub(crate) struct ResetHandle(Arc<AtomicBool>);

impl ResetHandle {
    /// Marks the connection to be reset as it closes. The service returns the [`Reset`], which
    /// makes hyper close the connection at once, unanswered.
    pub(crate) fn reset(&self) -> Reset {
        self.0.store(true, Ordering::Relaxed);
        Reset
    }
}

/// A request service's error for a connection reset by [`ResetHandle::reset`].
#[derive(Debug)]
pub(crate) struct Reset;

impl std::fmt::Display for Reset {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("client connection reset")
    }
}

impl Error for Reset {}

/// A client connection from the listener, closed with a reset (`SO_LINGER` 0) once its
/// [`ResetHandle`] is tripped.
struct ClientIo {
    tcp: TcpStream,
    reset: ResetHandle,
}

impl Drop for ClientIo {
    fn drop(&mut self) {
        if self.reset.0.load(Ordering::Relaxed)
            && let Err(e) = self.tcp.set_zero_linger()
        {
            debug!("Could not reset the client connection: {e}");
        }
    }
}

impl AsyncRead for ClientIo {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().tcp).poll_read(cx, buf)
    }
}

impl AsyncWrite for ClientIo {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().tcp).poll_write(cx, buf)
    }

    fn poll_write_vectored(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().tcp).poll_write_vectored(cx, bufs)
    }

    fn is_write_vectored(&self) -> bool {
        self.tcp.is_write_vectored()
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().tcp).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().tcp).poll_shutdown(cx)
    }
}
