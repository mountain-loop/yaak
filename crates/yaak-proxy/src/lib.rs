mod body;
mod cert;
mod connection;
mod decode;
mod decrypt;
mod grpc;
mod messages;
#[cfg(target_os = "macos")]
mod nw;
mod request;
mod sse;
mod tunnel;
mod ws;

use std::collections::HashMap;
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc as std_mpsc;
use std::sync::{Arc, Mutex, RwLock};
use std::time::SystemTime;

use bytes::Bytes;
use http::HeaderValue;
use hyper_util::client::legacy::Client;
#[cfg(not(target_os = "macos"))]
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::TokioExecutor;
use rustls::ClientConfig;
use rustls::pki_types::CertificateDer;
use tokio::net::TcpListener;

pub use cert::{CaStore, KeyCipher};
use connection::handle_connection;
pub use decrypt::{
    BUILT_IN_EXCLUSIONS, BuiltInKind, DecryptApp, DecryptEntry, DecryptPolicy, DecryptQuery,
    DecryptTarget, Verdict, built_in_kind,
};
pub use grpc::{detect as detect_grpc, service_and_method};
pub use messages::{MessageDirection, MessageKind, RAW_LIMIT, StreamKind, StreamMessage};
use request::BoxBody;

/// Hang-ups and other handshake errors in a row that pass an address through.
pub const PASSTHROUGH_AFTER_FAILURES: u32 = 2;

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
    /// Runs on a blocking thread as each client connection is accepted, with the connection's
    /// number and the client's address, before anything is read from it, so the client is
    /// still there to be looked up. The connection waits for it.
    pub on_accept: Option<AcceptHook>,
    /// Offer HTTP/2 to clients in intercepted TLS, beside HTTP/1.1. Off, they all speak
    /// HTTP/1.1, for clients that misbehave on HTTP/2. See [`ProxyHandle::set_http2`].
    pub http2: bool,
    /// Record WebSocket frames as messages. Off, upgraded connections are spliced blind, as
    /// other upgrades are.
    pub websocket_capture: bool,
    /// Which HTTPS connections are decrypted; the rest are tunnelled, recorded as a flow each
    /// without their contents. Everything by default. See [`ProxyHandle::set_decrypt_policy`].
    pub decrypt: DecryptPolicy,
    /// Finds the app that opened a client connection, by its number, for the policy's `app:`
    /// entries. Runs on a blocking thread as each CONNECT is judged, only while the policy has
    /// such an entry, and may wait briefly for a lookup in progress.
    pub app_of: Option<AppLookup>,
}

/// See [`ProxyConfig::on_accept`].
pub type AcceptHook = Arc<dyn Fn(u64, SocketAddr) + Send + Sync>;

/// See [`ProxyConfig::app_of`].
pub type AppLookup = Arc<dyn Fn(u64) -> Option<DecryptApp> + Send + Sync>;

impl ProxyConfig {
    pub fn new(port: u16, ca: Arc<CaStore>) -> Self {
        Self {
            port,
            ca,
            capture_body_limit: DEFAULT_CAPTURE_BODY_LIMIT,
            upstream_root_certs: Vec::new(),
            on_accept: None,
            http2: true,
            websocket_capture: true,
            decrypt: DecryptPolicy::everything(),
            app_of: None,
        }
    }
}

/// Lifecycle of each proxied exchange (a flow), keyed by `id`. A flow starts with
/// `RequestStart` and ends with exactly one `ResponseBodyComplete`, `StreamEnd`, `Error` or
/// `Cancelled`. Each HTTP/2 stream is a flow of its own. A streaming flow (WebSocket,
/// server-sent events, gRPC) has a `StreamStart` and then a `Message` for each message as it
/// passes. An HTTPS connection the engine tunnels without decrypting, because the decrypt policy
/// leaves it out or its client rejected the engine's certificate, is a flow of its own, from
/// `TunnelStart` to `TunnelEnd`. A client's failed handshake that starts its address being
/// passed through is a flow too, of the one event `HandshakeFailed`. Other traffic tunnelled
/// blind (non-TLS CONNECT payloads, upgrades to protocols other than WebSocket) produces no
/// events.
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
        /// The client connection the request came on, numbered from 1 for each run.
        connection: u64,
        /// The client's end of that connection, to find the app that opened it.
        client_addr: SocketAddr,
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
        /// Milliseconds from `started_at` to the body's end.
        elapsed_ms: u64,
    },
    /// The connection to the server an intercepted HTTPS request goes on, before it is sent.
    /// Plain HTTP shares pooled connections the engine does not see opened, so it has none.
    UpstreamConnection {
        id: u64,
        /// Milliseconds from `started_at` to the TCP connection, and to the TLS handshake's
        /// end. None when the connection was opened for an earlier request and reused.
        elapsed_connect_ms: Option<u64>,
        elapsed_tls_ms: Option<u64>,
        /// `TLSv1.3`, `TLSv1.2`.
        tls_version: Option<String>,
        /// `TLS13_AES_128_GCM_SHA256`.
        tls_cipher: Option<String>,
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
    /// The response body ended: normally, with `error` when upstream failed, or `cancelled`.
    ResponseBodyComplete {
        id: u64,
        size: u64,
        /// Whether `size` exceeded `capture_body_limit`.
        truncated: bool,
        /// Milliseconds from `started_at` to the end of the body.
        elapsed_ms: u64,
        error: Option<String>,
        /// The client stopped reading before the body ended: it reset the stream or closed the
        /// connection. Not an error of the engine's or the server's.
        cancelled: bool,
    },
    /// No response: connecting to or requesting from upstream failed, and the client got a 502,
    /// or the engine refused the request (no host to send it to, or it looped back to the engine)
    /// with a 4xx or 5xx of its own.
    Error {
        id: u64,
        error: String,
        elapsed_ms: u64,
    },
    /// The client gave up before the response headers arrived, by resetting the stream or
    /// closing the connection. The request upstream is cancelled with it.
    Cancelled { id: u64, elapsed_ms: u64 },
    /// The flow carries a stream of messages: from its request headers for gRPC, its response
    /// headers for server-sent events, its `101` for a WebSocket.
    StreamStart { id: u64, kind: StreamKind },
    /// A message of a streaming flow passed through.
    Message { id: u64, message: StreamMessage },
    /// A WebSocket ended: both sides sent a close frame, or the connection ended, with `error`
    /// when it failed. Its flow ends here, as the `101` has no body to complete.
    StreamEnd {
        id: u64,
        elapsed_ms: u64,
        error: Option<String>,
    },
    /// A CONNECT is tunnelled without being decrypted: its bytes pass untouched, and only their
    /// count is recorded. Open until its `TunnelEnd`; [`ProxyHandle::close_tunnels`] closes it
    /// by `id`.
    TunnelStart {
        id: u64,
        started_at: SystemTime,
        /// `host[:port]`, the port left out when it is 443.
        authority: String,
        /// The host, without an IPv6 address's brackets, and the port, as the policy judged them.
        host: String,
        port: u16,
        connection: u64,
        client_addr: SocketAddr,
        reason: TunnelReason,
    },
    /// The tunnel closed, with `error` when connecting upstream or relaying failed.
    TunnelEnd {
        id: u64,
        /// Bytes from the client to the server.
        sent: u64,
        /// Bytes from the server to the client.
        received: u64,
        elapsed_ms: u64,
        error: Option<String>,
        /// Closed by [`ProxyHandle::close_tunnels`], so the client reconnects.
        reconnect_requested: bool,
    },
    /// A client's TLS handshake with the engine failed, and its address (`host:port`) is now
    /// passed through: sent once per address each time it joins the pass-through set, not for
    /// every failure. At once for a certificate alert; after [`PASSTHROUGH_AFTER_FAILURES`] in a
    /// row for a hang-up or any other handshake error. A flow of its own, which nothing follows.
    HandshakeFailed {
        id: u64,
        started_at: SystemTime,
        /// `host[:port]`, the port left out when it is 443.
        authority: String,
        connection: u64,
        client_addr: SocketAddr,
        /// How the client rejected the engine's certificate: its alert (`unknown_ca`,
        /// `bad_certificate`, `certificate_unknown`, ...) or `hang_up`. None for any other
        /// handshake error, which is not a rejection.
        rejection: Option<String>,
        /// The error the handshake ended with.
        error: String,
        /// Milliseconds from `started_at` to the failure.
        elapsed_ms: u64,
    },
}

/// Why a CONNECT is tunnelled rather than decrypted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TunnelReason {
    /// No positive entry of the decrypt list matches it.
    NotListed,
    /// A positive entry matches it, and this exclusion keeps it out.
    Excluded { entry: String, built_in: bool },
    /// The policy decrypts it, but a client rejected the engine's certificate for its address,
    /// which is passed through for the rest of the run: `rejected_by` is the id of the
    /// `HandshakeFailed` flow that started it.
    Rejected { rejected_by: u64 },
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

    /// Forgets the hosts passed through after clients rejected the CA, so they are intercepted
    /// again, as once the CA is trusted.
    pub fn forget_passthrough(&self) {
        self.engine.passthrough.lock().unwrap().clear();
        self.engine.handshake_failures.lock().unwrap().clear();
    }

    /// Forgets one address (`host:port`) passed through after a client rejected the CA, so its
    /// next connection is intercepted again. Returns whether it was passed through.
    pub fn forget_passthrough_address(&self, addr: &str) -> bool {
        self.engine.handshake_failures.lock().unwrap().remove(addr);
        self.engine.passthrough.lock().unwrap().remove(addr).is_some()
    }

    /// The addresses (`host:port`) passed through after clients rejected the CA, sorted.
    pub fn passthrough(&self) -> Vec<String> {
        let mut addrs: Vec<String> =
            self.engine.passthrough.lock().unwrap().keys().cloned().collect();
        addrs.sort();
        addrs
    }

    /// Closes the open tunnels among `ids`, the `id`s of their `TunnelStart`s, so their clients
    /// reconnect. Each ends with a `TunnelEnd` whose `reconnect_requested` is set. Returns how
    /// many were open.
    pub fn close_tunnels(&self, ids: &[u64]) -> usize {
        let mut tunnels = self.engine.tunnels.lock().unwrap();
        ids.iter()
            .filter_map(|id| tunnels.remove(id))
            .map(|close| {
                let _ = close.send(());
            })
            .count()
    }

    /// Offers HTTP/2 to clients, or stops, from the next connection on. Connections already
    /// open keep the protocol they chose.
    pub fn set_http2(&self, enabled: bool) {
        self.engine.http2.store(enabled, Ordering::Relaxed);
    }

    /// Bytes of each body captured, for bodies that start from now on.
    pub fn set_capture_body_limit(&self, limit: usize) {
        self.engine.capture_body_limit.store(limit, Ordering::Relaxed);
    }

    /// Decides which HTTPS connections are decrypted from the next CONNECT on. Connections
    /// already open stay decrypted or tunnelled as they were.
    pub fn set_decrypt_policy(&self, policy: DecryptPolicy) {
        *self.engine.decrypt.write().unwrap() = Arc::new(policy);
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

/// The client connection a request came on.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ClientConn {
    connection: u64,
    addr: SocketAddr,
}

pub(crate) struct Engine {
    ca: Arc<CaStore>,
    capture_body_limit: AtomicUsize,
    events: std_mpsc::Sender<ProxyEvent>,
    next_id: AtomicU64,
    next_connection: AtomicU64,
    http_client: HttpClient,
    upstream_tls: Arc<ClientConfig>,
    upstream_tls_h1: Arc<ClientConfig>,
    /// Addresses (`host:port`) passed through after a client rejected the engine's certificate,
    /// each with the id of the `HandshakeFailed` flow that started it.
    passthrough: Mutex<HashMap<String, u64>>,
    handshake_failures: Mutex<HashMap<String, u32>>,
    /// Each open tunnel's way to close it, by its flow id. Touched as tunnels open and close.
    tunnels: Mutex<HashMap<u64, tokio::sync::oneshot::Sender<()>>>,
    /// Offer HTTP/2 to clients in intercepted TLS.
    http2: AtomicBool,
    websocket_capture: bool,
    decrypt: RwLock<Arc<DecryptPolicy>>,
    app_of: Option<AppLookup>,
    /// `Via` value marking the plain-HTTP requests the engine forwards, unique to this run, so one
    /// that comes back to the engine is refused instead of forwarded again.
    via: HeaderValue,
}

impl Engine {
    fn emit(&self, event: ProxyEvent) {
        let _ = self.events.send(event);
    }

    /// Bytes of each body captured, as it is when the body starts.
    fn capture_body_limit(&self) -> usize {
        self.capture_body_limit.load(Ordering::Relaxed)
    }

    fn next_flow_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    fn offers_http2(&self) -> bool {
        self.http2.load(Ordering::Relaxed)
    }

    fn decrypt_policy(&self) -> Arc<DecryptPolicy> {
        self.decrypt.read().unwrap().clone()
    }

    /// What the policy makes of a CONNECT to `host:port` on `connection`, looking up its app
    /// only when an entry names one.
    async fn verdict(&self, host: &str, port: u16, connection: u64) -> Verdict {
        let policy = self.decrypt_policy();
        if !policy.decrypts_anything() {
            return Verdict::NotListed;
        }
        let app = match &self.app_of {
            Some(app_of) if policy.needs_app() => {
                let app_of = app_of.clone();
                tokio::task::spawn_blocking(move || app_of(connection)).await.ok().flatten()
            }
            _ => None,
        };
        policy.judge(&DecryptQuery { host: host.to_string(), port, app })
    }

    /// The id of the `HandshakeFailed` flow that started passing `addr` through, while it is.
    fn passthrough_of(&self, addr: &str) -> Option<u64> {
        self.passthrough.lock().unwrap().get(addr).copied()
    }

    fn is_passthrough(&self, addr: &str) -> bool {
        self.passthrough_of(addr).is_some()
    }

    /// Counts a failed handshake toward passing `addr` through. macOS and Windows clients reject
    /// the CA with a bare hang-up, indistinguishable from an abandoned connection, so those need
    /// two in a row. When this failure is the one that adds `addr` to the pass-through set, which
    /// happens once however many fail together, emits `failed` with a new flow id, before any
    /// tunnel passed through for it can name that id, and returns true.
    fn record_handshake_failure(
        &self,
        addr: &str,
        certificate_rejected: bool,
        failed: impl FnOnce(u64) -> ProxyEvent,
    ) -> bool {
        let mut failures = self.handshake_failures.lock().unwrap();
        let count = failures.entry(addr.to_string()).or_default();
        *count += 1;
        if !certificate_rejected && *count < PASSTHROUGH_AFTER_FAILURES {
            return false;
        }
        failures.remove(addr);
        let mut passthrough = self.passthrough.lock().unwrap();
        match passthrough.entry(addr.to_string()) {
            std::collections::hash_map::Entry::Occupied(_) => false,
            std::collections::hash_map::Entry::Vacant(slot) => {
                let id = self.next_flow_id();
                slot.insert(id);
                self.emit(failed(id));
                true
            }
        }
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

/// Sends plain HTTP upstream. On macOS it connects through Network.framework, so Private Relay
/// can't route the engine's own port-80 connections back into the engine (see [`nw`]).
#[cfg(target_os = "macos")]
type HttpClient = Client<nw::Connector, BoxBody>;
#[cfg(not(target_os = "macos"))]
type HttpClient = Client<HttpConnector, BoxBody>;

fn http_client() -> HttpClient {
    let builder = Client::builder(TokioExecutor::new());
    #[cfg(target_os = "macos")]
    return builder.build(nw::Connector);
    #[cfg(not(target_os = "macos"))]
    builder.build_http()
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
        capture_body_limit: AtomicUsize::new(config.capture_body_limit),
        events: event_tx,
        next_id: AtomicU64::new(1),
        next_connection: AtomicU64::new(1),
        http_client: http_client(),
        upstream_tls: upstream_tls_config(&roots, &[b"h2", b"http/1.1"])?,
        upstream_tls_h1: upstream_tls_config(&roots, &[b"http/1.1"])?,
        passthrough: Mutex::new(HashMap::new()),
        handshake_failures: Mutex::new(HashMap::new()),
        tunnels: Mutex::new(HashMap::new()),
        http2: AtomicBool::new(config.http2),
        websocket_capture: config.websocket_capture,
        decrypt: RwLock::new(Arc::new(config.decrypt)),
        app_of: config.app_of,
        via: via_marker(),
    });

    let port = config.port;
    let on_accept = config.on_accept;
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
                        Ok((stream, addr)) => {
                            let engine = engine.clone();
                            let client = ClientConn {
                                connection: engine.next_connection.fetch_add(1, Ordering::Relaxed),
                                addr,
                            };
                            let on_accept = on_accept.clone();
                            tokio::spawn(async move {
                                if let Some(hook) = on_accept {
                                    let (connection, addr) = (client.connection, client.addr);
                                    let _ = tokio::task::spawn_blocking(move || hook(connection, addr)).await;
                                }
                                if let Err(e) = handle_connection(stream, client, engine).await {
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
