use crate::{McpHost, YaakMcpServer};
use bytes::Bytes;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use log::{debug, warn};
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

pub const DEFAULT_PORT: u16 = 64343;
pub const PATH: &str = "/mcp";

/// A running server. Dropping it does not stop it; call [`HttpServer::stop`].
pub struct HttpServer {
    pub addr: SocketAddr,
    cancel: CancellationToken,
    task: JoinHandle<()>,
}

impl HttpServer {
    pub async fn stop(self) {
        self.cancel.cancel();
        let _ = self.task.await;
    }
}

/// Serve the tools on `addr` at [`PATH`], answering only requests that carry
/// `Authorization: Bearer <token>`.
pub async fn serve<H: McpHost>(
    host: Arc<H>,
    addr: SocketAddr,
    token: String,
) -> std::io::Result<HttpServer> {
    let listener = TcpListener::bind(addr).await?;
    let addr = listener.local_addr()?;
    let cancel = CancellationToken::new();

    let config =
        StreamableHttpServerConfig::default().with_cancellation_token(cancel.child_token());
    let mcp = StreamableHttpService::new(
        move || Ok(YaakMcpServer::from_arc(host.clone())),
        Arc::new(LocalSessionManager::default()),
        config,
    );
    let expected = Arc::new(format!("Bearer {token}"));

    let accept_cancel = cancel.clone();
    let task = tokio::spawn(async move {
        loop {
            let stream = tokio::select! {
                _ = accept_cancel.cancelled() => break,
                accepted = listener.accept() => match accepted {
                    Ok((stream, _)) => stream,
                    Err(e) => {
                        warn!("MCP server failed to accept a connection: {e}");
                        continue;
                    }
                },
            };

            let mcp = mcp.clone();
            let expected = expected.clone();
            let conn_cancel = accept_cancel.clone();
            tokio::spawn(async move {
                let service = service_fn(move |req: Request<Incoming>| {
                    let mcp = mcp.clone();
                    let expected = expected.clone();
                    async move { Ok::<_, Infallible>(route(&mcp, &expected, req).await) }
                });
                let conn = http1::Builder::new().serve_connection(TokioIo::new(stream), service);
                tokio::select! {
                    _ = conn_cancel.cancelled() => {}
                    result = conn => if let Err(e) = result {
                        debug!("MCP connection ended: {e}");
                    },
                }
            });
        }
    });

    Ok(HttpServer { addr, cancel, task })
}

async fn route<S>(
    mcp: &StreamableHttpService<S, LocalSessionManager>,
    expected: &str,
    req: Request<Incoming>,
) -> Response<BoxBody<Bytes, Infallible>>
where
    S: rmcp::ServerHandler + Send + 'static,
{
    if req.uri().path() != PATH {
        return plain(StatusCode::NOT_FOUND, "Not found");
    }
    let given = req.headers().get(hyper::header::AUTHORIZATION).map(|v| v.as_bytes());
    if !given.is_some_and(|given| constant_time_eq(given, expected.as_bytes())) {
        let mut response = plain(StatusCode::UNAUTHORIZED, "Missing or invalid bearer token");
        response
            .headers_mut()
            .insert(hyper::header::WWW_AUTHENTICATE, "Bearer".parse().expect("valid header"));
        return response;
    }
    mcp.handle(req).await
}

fn plain(status: StatusCode, message: &'static str) -> Response<BoxBody<Bytes, Infallible>> {
    let mut response = Response::new(Full::new(Bytes::from_static(message.as_bytes())).boxed());
    *response.status_mut() = status;
    response
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
