use std::sync::Arc;
use std::sync::mpsc as std_mpsc;

use hyper::server::conn::http1;
use hyper::service::service_fn;
use tokio::net::TcpStream;

use crate::ProxyEvent;
use crate::cert::CertificateAuthority;
use crate::request::handle_request;

pub(crate) async fn handle_connection(
    stream: TcpStream,
    event_tx: std_mpsc::Sender<ProxyEvent>,
    ca: Arc<CertificateAuthority>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let tx = event_tx.clone();
    http1::Builder::new()
        .preserve_header_case(true)
        .title_case_headers(true)
        .serve_connection(
            hyper_util::rt::TokioIo::new(stream),
            service_fn(move |req| {
                let tx = tx.clone();
                let ca = ca.clone();
                async move { handle_request(req, tx, ca).await }
            }),
        )
        .with_upgrades()
        .await
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
}
