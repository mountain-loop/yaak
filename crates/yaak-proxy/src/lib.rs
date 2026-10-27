mod body;
mod cert;
mod connection;
mod request;
mod tunnel;

use std::collections::hash_map::RandomState;
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasher, Hasher};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc as std_mpsc;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use bytes::Bytes;
use http::HeaderValue;
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::TokioExecutor;
use rustls::ClientConfig;
use rustls::pki_types::CertificateDer;
use tokio::net::TcpListener;

pub use cert::CaStore;
use connection::handle_connection;
use request::BoxBody;

const PASSTHROUGH_AFTER_FAILURES: u32 = 2;

/// Default for [`ProxyConfig::capture_body_limit`]: 10 MB.
pub const DEFAULT_CAPTURE_BODY_LIMIT: usize = 10 * 1024 * 1024;

/// Settings for one run of the engine.
pub struct ProxyConfig {
    /// Port to listen on at 127.0.0.1; 0 picks a free one (see [`ProxyHandle::port`]).
    pub port: u16,
    /// Signs the per-host certificates presented to clients.
    pub ca: Arc<CaStore>,
    /// Bytes of each request and response body carried in chunk events. The rest still
    /// streams through, counted but not captured.
    pub capture_body_limit: usize,
    /// Roots trusted for upstream TLS in addition to the platform's.
    pub upstream_root_certs: Vec<CertificateDer<'static>>,
}

impl ProxyConfig {
    pub fn new(port: u16, ca: Arc<CaStore>) -> Self {
        Self {
            port,
            ca,
            capture_body_limit: DEFAULT_CAPTURE_BODY_LIMIT,
            upstream_root_certs: Vec::new(),
        }
    }
}

/// Lifecycle of each proxied exchange (a flow), keyed by `id`. A flow starts with
/// `RequestStart` and ends with exactly one `ResponseBodyComplete` or `Error`. Traffic the
/// engine tunnels without decrypting (pinned clients, non-TLS CONNECT payloads, the frames
/// after a `101 Switching Protocols`) produces no events.
#[derive(Debug, Clone)]
pub enum ProxyEvent {
    /// Request headers arrived from the client.
    RequestStart {
        id: u64,
        started_at: SystemTime,
        method: String,
        url: String,
        /// Version spoken by the client.
        http_version: String,
    },
    RequestHeader {
        id: u64,
        name: String,
        value: String,
    },
    /// A frame of the request body was forwarded upstream.
    RequestBodyChunk {
        id: u64,
        /// Bytes in the frame.
        len: usize,
        /// The captured part of the frame; empty once `capture_body_limit` is reached.
        data: Bytes,
    },
    /// The request body finished streaming upstream. Not sent when the request has no body.
    RequestBodyComplete {
        id: u64,
        size: u64,
        /// Whether `size` exceeded `capture_body_limit`.
        truncated: bool,
    },
    /// Response headers arrived from upstream.
    ResponseStart {
        id: u64,
        status: u16,
        /// Version spoken with the upstream server.
        http_version: String,
        remote_addr: Option<SocketAddr>,
        /// Milliseconds from `started_at` to the response headers.
        elapsed_ms: u64,
    },
    ResponseHeader {
        id: u64,
        name: String,
        value: String,
    },
    /// A frame of the response body was forwarded to the client.
    ResponseBodyChunk {
        id: u64,
        /// Bytes in the frame.
        len: usize,
        /// The captured part of the frame; empty once `capture_body_limit` is reached.
        data: Bytes,
    },
    /// The response body ended, normally or with `error` (upstream failed or client left).
    ResponseBodyComplete {
        id: u64,
        size: u64,
        /// Whether `size` exceeded `capture_body_limit`.
        truncated: bool,
        /// Milliseconds from `started_at` to the end of the body.
        elapsed_ms: u64,
        error: Option<String>,
    },
    /// No response: connecting to or requesting from upstream failed, and the client got a 502,
    /// or the engine refused the request (no host to send it to, or it looped back to the engine)
    /// with a 4xx or 5xx of its own.
    Error {
        id: u64,
        error: String,
        elapsed_ms: u64,
    },
}

/// A running engine. Dropping it stops the listener and joins its thread.
pub struct ProxyHandle {
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    thread_handle: Option<std::thread::JoinHandle<()>>,
    event_rx: Option<std_mpsc::Receiver<ProxyEvent>>,
    engine: Arc<Engine>,
    /// The bound port.
    pub port: u16,
}

impl ProxyHandle {
    /// Take the event receiver. Can only be called once — returns `None` after the first call.
    pub fn take_event_rx(&mut self) -> Option<std_mpsc::Receiver<ProxyEvent>> {
        self.event_rx.take()
    }

    /// Handshake failures counted toward passing `addr` (`host:port`) through, and whether it
    /// already is. For tests that must wait for the engine to record a failure.
    #[doc(hidden)]
    pub fn handshake_state(&self, addr: &str) -> (u32, bool) {
        let failures = self.engine.handshake_failures.lock().unwrap().get(addr).copied();
        (failures.unwrap_or_default(), self.engine.is_passthrough(addr))
    }
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

pub(crate) struct Engine {
    ca: Arc<CaStore>,
    capture_body_limit: usize,
    events: std_mpsc::Sender<ProxyEvent>,
    next_id: AtomicU64,
    http_client: Client<HttpConnector, BoxBody>,
    upstream_tls: Arc<ClientConfig>,
    upstream_tls_h1: Arc<ClientConfig>,
    passthrough: Mutex<HashSet<String>>,
    handshake_failures: Mutex<HashMap<String, u32>>,
    /// `Via` value marking requests whose URL the engine rebuilt from `Host`, unique to this run,
    /// so one that comes back to the engine is refused instead of forwarded again.
    via: HeaderValue,
}

impl Engine {
    fn emit(&self, event: ProxyEvent) {
        let _ = self.events.send(event);
    }

    fn next_flow_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    fn is_passthrough(&self, addr: &str) -> bool {
        self.passthrough.lock().unwrap().contains(addr)
    }

    /// Returns whether `addr` is now passed through. macOS and Windows clients reject the CA with
    /// a bare hang-up, indistinguishable from an abandoned connection, so those need two in a row.
    fn record_handshake_failure(&self, addr: &str, certificate_rejected: bool) -> bool {
        let mut failures = self.handshake_failures.lock().unwrap();
        let count = failures.entry(addr.to_string()).or_default();
        *count += 1;
        if !certificate_rejected && *count < PASSTHROUGH_AFTER_FAILURES {
            return false;
        }
        failures.remove(addr);
        self.passthrough.lock().unwrap().insert(addr.to_string());
        true
    }

    fn record_handshake_success(&self, addr: &str) {
        self.handshake_failures.lock().unwrap().remove(addr);
    }
}

fn upstream_tls_config(
    roots: &rustls::RootCertStore,
    alpn: &[&[u8]],
) -> Result<Arc<ClientConfig>, String> {
    let mut config =
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .map_err(|e| e.to_string())?
            .with_root_certificates(roots.clone())
            .with_no_client_auth();
    config.alpn_protocols = alpn.iter().map(|p| p.to_vec()).collect();
    Ok(Arc::new(config))
}

fn via_marker() -> HeaderValue {
    let run = RandomState::new().build_hasher().finish();
    HeaderValue::try_from(format!("1.1 yaak-proxy-{run:016x}")).unwrap()
}

/// Starts the engine on its own thread and Tokio runtime, returning once the port is bound.
pub fn start_proxy(config: ProxyConfig) -> Result<ProxyHandle, String> {
    let mut roots = rustls::RootCertStore::empty();
    for cert in rustls_native_certs::load_native_certs().certs {
        let _ = roots.add(cert);
    }
    for cert in config.upstream_root_certs {
        roots.add(cert).map_err(|e| format!("Invalid upstream root certificate: {e}"))?;
    }

    let (event_tx, event_rx) = std_mpsc::channel();
    let engine = Arc::new(Engine {
        ca: config.ca,
        capture_body_limit: config.capture_body_limit,
        events: event_tx,
        next_id: AtomicU64::new(1),
        http_client: Client::builder(TokioExecutor::new()).build_http(),
        upstream_tls: upstream_tls_config(&roots, &[b"h2", b"http/1.1"])?,
        upstream_tls_h1: upstream_tls_config(&roots, &[b"http/1.1"])?,
        passthrough: Mutex::new(HashSet::new()),
        handshake_failures: Mutex::new(HashMap::new()),
        via: via_marker(),
    });

    let port = config.port;
    let handle_engine = engine.clone();
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
            let listener = match TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).await {
                Ok(l) => l,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("Failed to bind port {port}: {e}")));
                    return;
                }
            };
            let bound = listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string());
            let _ = ready_tx.send(bound);
            log::info!("Proxy listening on {:?}", listener.local_addr());

            let mut shutdown_rx = shutdown_rx;
            loop {
                tokio::select! {
                    result = listener.accept() => match result {
                        Ok((stream, _)) => {
                            let engine = engine.clone();
                            tokio::spawn(async move {
                                if let Err(e) = handle_connection(stream, engine).await {
                                    log::debug!("Client connection error: {e}");
                                }
                            });
                        }
                        Err(e) => log::warn!("Accept error: {e}"),
                    },
                    _ = &mut shutdown_rx => break,
                }
            }
        });
    });

    match ready_rx.recv() {
        Ok(Ok(port)) => Ok(ProxyHandle {
            shutdown_tx: Some(shutdown_tx),
            thread_handle: Some(thread_handle),
            event_rx: Some(event_rx),
            engine: handle_engine,
            port,
        }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("Proxy thread died before binding".into()),
    }
}
