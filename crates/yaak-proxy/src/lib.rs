pub mod body;
pub mod cert;
mod connection;
mod request;

use std::net::SocketAddr;
use std::sync::atomic::AtomicU64;
use std::sync::mpsc as std_mpsc;
use std::sync::Arc;

use cert::CertificateAuthority;
use tokio::net::TcpListener;

use connection::handle_connection;

static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

/// Granular events emitted during request/response lifecycle.
/// Each event carries a request `id` so consumers can correlate events.
#[derive(Debug, Clone)]
pub enum ProxyEvent {
    /// A new request has been received from the client.
    RequestStart {
        id: u64,
        method: String,
        url: String,
        http_version: String,
    },
    /// A request header sent to the upstream server.
    RequestHeader { id: u64, name: String, value: String },
    /// The full request body (buffered before forwarding).
    RequestBody { id: u64, body: Vec<u8> },
    /// Response headers received from upstream.
    ResponseStart {
        id: u64,
        status: u16,
        http_version: String,
        elapsed_ms: u64,
    },
    /// A response header received from the upstream server.
    ResponseHeader { id: u64, name: String, value: String },
    /// A chunk of the response body was received (emitted per-frame).
    ResponseBodyChunk { id: u64, bytes: usize },
    /// The response body stream has completed.
    ResponseBodyComplete {
        id: u64,
        body: Option<Vec<u8>>,
        size: u64,
        elapsed_ms: u64,
    },
    /// The upstream request failed.
    Error { id: u64, error: String },
}

/// Accumulated view of a proxied request, built from `ProxyEvent`s.
#[derive(Debug, Clone)]
pub struct CapturedRequest {
    pub id: u64,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub elapsed_ms: Option<u64>,
    pub http_version: String,
    pub remote_http_version: Option<String>,
    pub request_headers: Vec<(String, String)>,
    pub request_body: Option<Vec<u8>>,
    pub response_headers: Vec<(String, String)>,
    pub response_body: Option<Vec<u8>>,
    pub response_body_size: u64,
    pub state: RequestState,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RequestState {
    Sending,
    Receiving,
    Complete,
    Error,
}

pub struct ProxyHandle {
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    thread_handle: Option<std::thread::JoinHandle<()>>,
    pub event_rx: std_mpsc::Receiver<ProxyEvent>,
    pub port: u16,
    pub ca_pem: String,
}

impl Drop for ProxyHandle {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
    }
}

pub fn start_proxy(port: u16) -> Result<ProxyHandle, String> {
    let ca = CertificateAuthority::new().map_err(|e| format!("Failed to create CA: {e}"))?;
    let ca_pem = ca.ca_pem();
    let ca = Arc::new(ca);

    let (event_tx, event_rx) = std_mpsc::channel();
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let (ready_tx, ready_rx) = std_mpsc::channel();

    let thread_handle = std::thread::spawn(move || {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(rt) => rt,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("Failed to create runtime: {e}")));
                return;
            }
        };

        rt.block_on(async move {
            let addr = SocketAddr::from(([127, 0, 0, 1], port));
            let listener = match TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("Failed to bind: {e}")));
                    return;
                }
            };

            let bound_port = listener.local_addr().unwrap().port();
            let _ = ready_tx.send(Ok(bound_port));

            let mut shutdown_rx = shutdown_rx;
            loop {
                tokio::select! {
                    result = listener.accept() => {
                        match result {
                            Ok((stream, _addr)) => {
                                let tx = event_tx.clone();
                                let ca = ca.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = handle_connection(stream, tx, ca).await {
                                        eprintln!("Connection error: {e}");
                                    }
                                });
                            }
                            Err(e) => eprintln!("Accept error: {e}"),
                        }
                    }
                    _ = &mut shutdown_rx => {
                        break;
                    }
                }
            }
        });
    });

    match ready_rx.recv() {
        Ok(Ok(bound_port)) => Ok(ProxyHandle {
            shutdown_tx: Some(shutdown_tx),
            thread_handle: Some(thread_handle),
            event_rx,
            port: bound_port,
            ca_pem,
        }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("Proxy thread died before binding".into()),
    }
}
