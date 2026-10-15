use std::sync::Arc;

use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncWrite};

use crate::Engine;
use crate::request::handle_request;

pub(crate) async fn serve_http1<S, F, Fut>(io: S, handler: F) -> Result<(), hyper::Error>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    F: Fn(hyper::Request<hyper::body::Incoming>) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<hyper::Response<crate::request::BoxBody>, std::convert::Infallible>>
        + Send
        + 'static,
{
    http1::Builder::new()
        .preserve_header_case(true)
        .title_case_headers(true)
        .serve_connection(TokioIo::new(io), service_fn(handler))
        .with_upgrades()
        .await
}

pub(crate) async fn handle_connection(
    stream: tokio::net::TcpStream,
    engine: Arc<Engine>,
) -> Result<(), hyper::Error> {
    serve_http1(stream, move |req| handle_request(req, engine.clone())).await
}
