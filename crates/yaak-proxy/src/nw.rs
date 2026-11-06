//! Upstream TCP through Network.framework, for macOS.
//!
//! While a system web proxy is set, iCloud Private Relay hands every public port-80 connection
//! to that proxy, raw sockets included. When the proxy is this engine, its own upstream for
//! plain HTTP comes straight back to it. A Network.framework connection with `prefer_no_proxy`
//! goes to the origin instead. "Prefer" means it falls back to the proxy when there is no
//! direct route, so [`connect`] refuses a connection made through a proxy on this Mac, and the
//! `Via` loop guard stays in place behind it.

use std::collections::HashMap;
use std::ffi::{CStr, CString, c_char, c_void};
use std::future::Future;
use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV6};
use std::pin::Pin;
use std::ptr;
use std::sync::{Arc, LazyLock, Mutex, OnceLock};
use std::task::{Context, Poll, Waker};
use std::time::{Duration, Instant};

use block2::{Block, RcBlock};
use bytes::Bytes;
use dispatch2::{DispatchData, DispatchQueue, DispatchRetained};
use hyper::Uri;
use hyper::http::uri::Scheme;
use hyper_util::client::legacy::connect::{Connected, Connection as HyperConnection};
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::{oneshot, watch};

type NwObject = *mut c_void;

const STATE_WAITING: u32 = 1;
const STATE_READY: u32 = 3;
const STATE_FAILED: u32 = 4;
const STATE_CANCELLED: u32 = 5;
const ENDPOINT_TYPE_ADDRESS: u32 = 1;
const ENDPOINT_TYPE_HOST: u32 = 2;
const ENDPOINT_TYPE_URL: u32 = 4;
const ERROR_DOMAIN_POSIX: u32 = 1;
const ERROR_DOMAIN_DNS: u32 = 2;

/// Largest chunk asked of one receive.
const MAX_READ: u32 = 64 * 1024;
/// Bytes handed to Network.framework but not yet taken by the stack. Writes wait above this.
const MAX_IN_FLIGHT: usize = 256 * 1024;

#[link(name = "Network", kind = "framework")]
unsafe extern "C" {
    static _nw_parameters_configure_protocol_disable: NwObject;
    static _nw_parameters_configure_protocol_default_configuration: NwObject;
    static _nw_content_context_default_message: NwObject;
    static _nw_content_context_final_send: NwObject;

    fn nw_release(obj: NwObject);
    fn nw_endpoint_create_host(host: *const c_char, port: *const c_char) -> NwObject;
    fn nw_endpoint_get_type(endpoint: NwObject) -> u32;
    fn nw_endpoint_get_address(endpoint: NwObject) -> *const libc::sockaddr;
    fn nw_endpoint_get_hostname(endpoint: NwObject) -> *const c_char;
    fn nw_endpoint_get_url(endpoint: NwObject) -> *const c_char;
    fn nw_parameters_create_secure_tcp(
        configure_tls: NwObject,
        configure_tcp: NwObject,
    ) -> NwObject;
    fn nw_parameters_set_prefer_no_proxy(parameters: NwObject, prefer_no_proxy: bool);
    fn nw_connection_create(endpoint: NwObject, parameters: NwObject) -> NwObject;
    fn nw_connection_set_queue(connection: NwObject, queue: NwObject);
    fn nw_connection_set_state_changed_handler(
        connection: NwObject,
        handler: &Block<dyn Fn(u32, NwObject)>,
    );
    fn nw_connection_start(connection: NwObject);
    fn nw_connection_cancel(connection: NwObject);
    fn nw_connection_copy_current_path(connection: NwObject) -> NwObject;
    fn nw_path_copy_effective_remote_endpoint(path: NwObject) -> NwObject;
    fn nw_connection_send(
        connection: NwObject,
        content: NwObject,
        context: NwObject,
        is_complete: bool,
        completion: &Block<dyn Fn(NwObject)>,
    );
    fn nw_connection_receive(
        connection: NwObject,
        minimum_incomplete_length: u32,
        maximum_length: u32,
        // `is_complete` is a C `bool`, which block2 can't encode; `u8` has the same ABI.
        completion: &Block<dyn Fn(NwObject, NwObject, u8, NwObject)>,
    );
    fn nw_content_context_get_is_final(context: NwObject) -> bool;
    fn nw_connection_access_establishment_report(
        connection: NwObject,
        queue: NwObject,
        access_block: &Block<dyn Fn(NwObject)>,
    );
    fn nw_establishment_report_get_used_proxy(report: NwObject) -> bool;
    fn nw_establishment_report_copy_proxy_endpoint(report: NwObject) -> NwObject;
    fn nw_error_get_error_domain(error: NwObject) -> u32;
    fn nw_error_get_error_code(error: NwObject) -> i32;
}

/// An `nw_error_t`, kept as its domain and code so it can be reported more than once.
#[derive(Clone, Copy, Debug)]
struct NwError {
    domain: u32,
    code: i32,
}

impl NwError {
    /// Reads `error`, an `nw_error_t`; `None` when it is null.
    fn from_raw(error: NwObject) -> Option<Self> {
        if error.is_null() {
            return None;
        }
        // SAFETY: `error` is a live `nw_error_t` for the duration of the callback.
        unsafe {
            Some(Self {
                domain: nw_error_get_error_domain(error),
                code: nw_error_get_error_code(error),
            })
        }
    }

    fn to_io(self) -> io::Error {
        match self.domain {
            ERROR_DOMAIN_POSIX => io::Error::from_raw_os_error(self.code),
            ERROR_DOMAIN_DNS => {
                io::Error::other(format!("failed to look up address (DNS error {})", self.code))
            }
            _ => io::Error::other(format!(
                "Network.framework error (domain {}, code {})",
                self.domain, self.code
            )),
        }
    }
}

/// An `nw_connection_t`, cancelled when dropped.
struct Connection(NwObject);

// SAFETY: Network.framework objects are thread-safe.
unsafe impl Send for Connection {}
unsafe impl Sync for Connection {}

impl Drop for Connection {
    fn drop(&mut self) {
        // SAFETY: `self.0` is a connection this wrapper owns a reference to.
        unsafe {
            nw_connection_cancel(self.0);
            nw_release(self.0);
        }
    }
}

impl Connection {
    /// The address the connection reached, from its current path.
    fn remote_addr(&self) -> Option<SocketAddr> {
        // SAFETY: the path and endpoint are copies released here, and the address they hand out
        // lives as long as the endpoint.
        unsafe {
            let path = nw_connection_copy_current_path(self.0);
            if path.is_null() {
                return None;
            }
            let endpoint = nw_path_copy_effective_remote_endpoint(path);
            nw_release(path);
            if endpoint.is_null() {
                return None;
            }
            let addr = if nw_endpoint_get_type(endpoint) == ENDPOINT_TYPE_ADDRESS {
                socket_addr(nw_endpoint_get_address(endpoint))
            } else {
                None
            };
            nw_release(endpoint);
            addr
        }
    }

    /// Whether the ready connection went through a proxy on this Mac instead of direct.
    async fn used_local_proxy(&self) -> bool {
        let (tx, rx) = oneshot::channel();
        {
            let tx = Mutex::new(Some(tx));
            let on_report = RcBlock::new(move |report: NwObject| {
                // SAFETY: a non-null `report` is live for the callback, and the endpoint copied
                // from it is released here.
                let local = !report.is_null()
                    && unsafe {
                        nw_establishment_report_get_used_proxy(report) && {
                            let endpoint = nw_establishment_report_copy_proxy_endpoint(report);
                            let local = endpoint.is_null() || is_local_endpoint(endpoint);
                            if !endpoint.is_null() {
                                nw_release(endpoint);
                            }
                            local
                        }
                    };
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(local);
                }
            });
            let queue = DispatchQueue::new("app.yaak.proxy.upstream-report", None);
            // SAFETY: the connection is live; the queue is retained and the block copied.
            unsafe {
                let queue = DispatchRetained::as_ptr(&queue).as_ptr().cast();
                nw_connection_access_establishment_report(self.0, queue, &on_report);
            }
        }
        // The report comes exactly once; without it, assume a direct connection.
        rx.await.unwrap_or(false)
    }

    /// Sends `data`, or with `None` closes the sending side (a FIN).
    fn send(&self, data: Option<&[u8]>, done: &Block<dyn Fn(NwObject)>) {
        let content = data.map(DispatchData::from_bytes);
        let content_ptr =
            content.as_ref().map_or(ptr::null_mut(), |d| DispatchRetained::as_ptr(d).as_ptr());
        // SAFETY: the connection and content are live; Network.framework retains the content and
        // copies the block.
        unsafe {
            let context = if data.is_some() {
                _nw_content_context_default_message
            } else {
                _nw_content_context_final_send
            };
            nw_connection_send(self.0, content_ptr.cast(), context, true, done);
        }
    }
}

/// # Safety
/// `sa` is null or points to a valid `sockaddr` of the length its family implies.
unsafe fn socket_addr(sa: *const libc::sockaddr) -> Option<SocketAddr> {
    if sa.is_null() {
        return None;
    }
    // SAFETY: the family says which `sockaddr_*` `sa` points to.
    unsafe {
        match i32::from((*sa).sa_family) {
            libc::AF_INET => {
                let sin = &*sa.cast::<libc::sockaddr_in>();
                let ip = Ipv4Addr::from(u32::from_be(sin.sin_addr.s_addr));
                Some(SocketAddr::from((ip, u16::from_be(sin.sin_port))))
            }
            libc::AF_INET6 => {
                let sin6 = &*sa.cast::<libc::sockaddr_in6>();
                let ip = Ipv6Addr::from(sin6.sin6_addr.s6_addr);
                let port = u16::from_be(sin6.sin6_port);
                Some(SocketAddrV6::new(ip, port, sin6.sin6_flowinfo, sin6.sin6_scope_id).into())
            }
            _ => None,
        }
    }
}

/// What one receive delivered.
struct Received {
    data: Bytes,
    /// The peer closed its sending side after `data`.
    eof: bool,
    /// The connection failed after `data`.
    error: Option<NwError>,
}

#[derive(Default)]
struct ReadState {
    /// A receive was issued and has not completed.
    pending: bool,
    received: Option<Received>,
    waker: Option<Waker>,
}

#[derive(Default)]
struct WriteState {
    /// Sends issued whose completion has not run, counting the FIN.
    sends: usize,
    bytes: usize,
    /// The first send that failed. Every later write, flush and shutdown reports it.
    error: Option<NwError>,
    waker: Option<Waker>,
}

/// State the completion handlers share with the stream; they run on the connection's queue.
#[derive(Default)]
struct Shared {
    read: Mutex<ReadState>,
    write: Mutex<WriteState>,
}

/// A TCP connection opened by Network.framework with `prefer_no_proxy`. Reads ask for one chunk
/// at a time, so a slow reader closes the TCP window; writes wait once [`MAX_IN_FLIGHT`] bytes
/// are queued. Shutdown sends a FIN, and dropping the stream cancels the connection.
pub(crate) struct NwStream {
    conn: Connection,
    shared: Arc<Shared>,
    remote_addr: Option<SocketAddr>,
    buffered: Bytes,
    eof: bool,
    read_error: Option<NwError>,
    fin_sent: bool,
}

impl NwStream {
    pub(crate) fn remote_addr(&self) -> Option<SocketAddr> {
        self.remote_addr
    }

    fn receive(&self) {
        let shared = self.shared.clone();
        let done = RcBlock::new(
            move |content: NwObject, context: NwObject, is_complete: u8, error: NwObject| {
                let data = if content.is_null() {
                    Bytes::new()
                } else {
                    // SAFETY: a non-null `content` is a `dispatch_data_t` live for the callback.
                    Bytes::from(unsafe { &*content.cast::<DispatchData>() }.to_vec())
                };
                // SAFETY: a non-null `context` is a live `nw_content_context_t`.
                let eof = is_complete != 0
                    && (context.is_null() || unsafe { nw_content_context_get_is_final(context) });
                let received = Received { data, eof, error: NwError::from_raw(error) };
                let mut read = shared.read.lock().unwrap();
                read.pending = false;
                read.received = Some(received);
                if let Some(waker) = read.waker.take() {
                    waker.wake();
                }
            },
        );
        // SAFETY: the connection is live and Network.framework copies the block.
        unsafe { nw_connection_receive(self.conn.0, 1, MAX_READ, &done) };
    }

    fn send(&self, data: Option<&[u8]>) {
        let shared = self.shared.clone();
        let len = data.map_or(0, <[u8]>::len);
        {
            let mut write = shared.write.lock().unwrap();
            write.sends += 1;
            write.bytes += len;
        }
        let done = RcBlock::new(move |error: NwObject| {
            let mut write = shared.write.lock().unwrap();
            write.sends -= 1;
            write.bytes -= len;
            if write.error.is_none() {
                write.error = NwError::from_raw(error);
            }
            if let Some(waker) = write.waker.take() {
                waker.wake();
            }
        });
        self.conn.send(data, &done);
    }
}

impl AsyncRead for NwStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if buf.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }
        loop {
            if !this.buffered.is_empty() {
                let n = this.buffered.len().min(buf.remaining());
                buf.put_slice(&this.buffered.split_to(n));
                return Poll::Ready(Ok(()));
            }
            if let Some(error) = this.read_error.take() {
                return Poll::Ready(Err(error.to_io()));
            }
            if this.eof {
                return Poll::Ready(Ok(()));
            }

            let mut read = this.shared.read.lock().unwrap();
            if let Some(received) = read.received.take() {
                drop(read);
                this.buffered = received.data;
                this.eof = received.eof;
                this.read_error = received.error;
                continue;
            }
            read.waker = Some(cx.waker().clone());
            if !read.pending {
                read.pending = true;
                drop(read);
                this.receive();
            }
            return Poll::Pending;
        }
    }
}

impl AsyncWrite for NwStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        if this.fin_sent {
            return Poll::Ready(Err(io::ErrorKind::BrokenPipe.into()));
        }
        {
            let mut write = this.shared.write.lock().unwrap();
            if let Some(error) = write.error {
                return Poll::Ready(Err(error.to_io()));
            }
            if write.bytes >= MAX_IN_FLIGHT {
                write.waker = Some(cx.waker().clone());
                return Poll::Pending;
            }
        }
        if buf.is_empty() {
            return Poll::Ready(Ok(0));
        }
        this.send(Some(buf));
        Poll::Ready(Ok(buf.len()))
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let mut write = self.shared.write.lock().unwrap();
        if write.sends > 0 {
            write.waker = Some(cx.waker().clone());
            return Poll::Pending;
        }
        Poll::Ready(write.error.map_or(Ok(()), |e| Err(e.to_io())))
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if !self.fin_sent {
            std::task::ready!(self.as_mut().poll_flush(cx))?;
            self.fin_sent = true;
            self.send(None);
        }
        self.poll_flush(cx)
    }
}

/// How long an open that went through a proxy on this Mac marks its target as the engine's own.
const OWN_FALLBACK_WINDOW: Duration = Duration::from_secs(10);
/// Longest wait in [`is_own_fallback`] for the opens of the same target to finish, all together.
/// The engine's own fallback finishes within milliseconds of the engine answering its `CONNECT`.
const OWN_FALLBACK_WAIT: Duration = Duration::from_secs(2);

/// One open by [`connect`] that is under way, or recently went through a proxy on this Mac.
struct Attempt {
    /// `None` while connecting, then whether it went through a proxy on this Mac.
    outcome: watch::Sender<Option<bool>>,
    ended: OnceLock<Instant>,
}

/// Every [`Attempt`] by normalized `host:port`.
static ATTEMPTS: LazyLock<Mutex<HashMap<String, Vec<Arc<Attempt>>>>> =
    LazyLock::new(Mutex::default);

fn attempt_key(host: &str, port: u16) -> String {
    let host = host.trim_start_matches('[').trim_end_matches(']').trim_end_matches('.');
    format!("{}:{port}", host.to_ascii_lowercase())
}

/// Drops the attempts that ended without a local proxy, and those past the window.
fn prune_attempts(attempts: &mut HashMap<String, Vec<Arc<Attempt>>>) {
    attempts.retain(|_, list| {
        list.retain(|a| match a.ended.get() {
            None => true,
            Some(ended) => {
                *a.outcome.borrow() == Some(true) && ended.elapsed() < OWN_FALLBACK_WINDOW
            }
        });
        !list.is_empty()
    });
}

/// Registers an open for [`is_own_fallback`]; ends it as direct when dropped unfinished.
struct AttemptGuard(Arc<Attempt>);

impl AttemptGuard {
    fn start(host: &str, port: u16) -> Self {
        let attempt =
            Arc::new(Attempt { outcome: watch::Sender::new(None), ended: OnceLock::new() });
        let mut attempts = ATTEMPTS.lock().unwrap();
        prune_attempts(&mut attempts);
        attempts.entry(attempt_key(host, port)).or_default().push(attempt.clone());
        Self(attempt)
    }

    /// Records the outcome; only the first call counts.
    fn finish(&self, via_local_proxy: bool) {
        self.0.outcome.send_if_modified(|outcome| {
            outcome.get_or_insert(via_local_proxy);
            true
        });
        let _ = self.0.ended.set(Instant::now());
    }
}

impl Drop for AttemptGuard {
    fn drop(&mut self) {
        self.finish(false);
    }
}

/// Whether a `CONNECT` to `host:port` may be one of the engine's own connections that fell back
/// to the system proxy, which is this engine: an open of the same target went through a proxy on
/// this Mac. Waits for opens of it that are under way, since the one that sent the `CONNECT`
/// finishes as soon as the engine answers it. An open that went direct never sent one. They are
/// watched together, up to [`OWN_FALLBACK_WAIT`] in all: the first through a local proxy answers
/// yes, and once every one has finished without, no.
pub(crate) async fn is_own_fallback(host: &str, port: u16) -> bool {
    let pending = {
        let mut attempts = ATTEMPTS.lock().unwrap();
        prune_attempts(&mut attempts);
        attempts.get(&attempt_key(host, port)).cloned().unwrap_or_default()
    };
    let mut outcomes = tokio::task::JoinSet::new();
    for attempt in pending {
        let mut outcome = attempt.outcome.subscribe();
        outcomes.spawn(async move {
            outcome.wait_for(Option::is_some).await.is_ok_and(|o| *o == Some(true))
        });
    }
    let deadline = tokio::time::Instant::now() + OWN_FALLBACK_WAIT;
    // Dropping the set at the end aborts the waits still running.
    while let Ok(Some(via_local_proxy)) =
        tokio::time::timeout_at(deadline, outcomes.join_next()).await
    {
        if via_local_proxy.unwrap_or(false) {
            return true;
        }
    }
    false
}

/// Opens a TCP connection to `host:port` that skips the system proxy where it can.
pub(crate) async fn connect(host: &str, port: u16) -> io::Result<NwStream> {
    open(host, port, |_| {}).await
}

/// [`connect`], with `configure` given the `nw_parameters_t` before the connection is created.
async fn open(host: &str, port: u16, configure: impl FnOnce(NwObject)) -> io::Result<NwStream> {
    let invalid = || io::Error::new(io::ErrorKind::InvalidInput, format!("invalid host {host:?}"));
    let c_host = CString::new(host).map_err(|_| invalid())?;
    let c_port = CString::new(port.to_string()).map_err(|_| invalid())?;

    // SAFETY: the C strings outlive the call, and each object created here is released once.
    let conn = unsafe {
        let endpoint = nw_endpoint_create_host(c_host.as_ptr(), c_port.as_ptr());
        if endpoint.is_null() {
            return Err(invalid());
        }
        let parameters = nw_parameters_create_secure_tcp(
            _nw_parameters_configure_protocol_disable,
            _nw_parameters_configure_protocol_default_configuration,
        );
        nw_parameters_set_prefer_no_proxy(parameters, true);
        configure(parameters);
        let conn = nw_connection_create(endpoint, parameters);
        nw_release(endpoint);
        nw_release(parameters);
        if conn.is_null() {
            return Err(invalid());
        }
        Connection(conn)
    };

    let attempt = AttemptGuard::start(host, port);

    // A refused or unroutable connection goes to `waiting` to retry when the network changes;
    // fail it there instead, as a socket would.
    let (ready_tx, ready_rx) = oneshot::channel::<Result<(), NwError>>();
    {
        let ready_tx = Mutex::new(Some(ready_tx));
        let on_state = RcBlock::new(move |state: u32, error: NwObject| {
            let result = match (state, NwError::from_raw(error)) {
                (STATE_READY, _) => Ok(()),
                (STATE_WAITING | STATE_FAILED, Some(error)) => Err(error),
                (STATE_FAILED | STATE_CANCELLED, None) => {
                    Err(NwError { domain: ERROR_DOMAIN_POSIX, code: libc::ECONNABORTED })
                }
                _ => return,
            };
            if let Some(tx) = ready_tx.lock().unwrap().take() {
                let _ = tx.send(result);
            }
        });
        let queue = DispatchQueue::new("app.yaak.proxy.upstream", None);
        // SAFETY: the connection is live; it retains the queue and copies the block.
        unsafe {
            nw_connection_set_queue(conn.0, DispatchRetained::as_ptr(&queue).as_ptr().cast());
            nw_connection_set_state_changed_handler(conn.0, &on_state);
            nw_connection_start(conn.0);
        }
    }

    match ready_rx.await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return Err(error.to_io()),
        Err(_) => return Err(io::ErrorKind::ConnectionAborted.into()),
    }
    // With no direct route, "prefer" falls back to the system proxy, sending `CONNECT` to it.
    // A proxy on this Mac may be this engine, which would tunnel it out the same way again, and
    // again: the tunnel checks `is_own_fallback` first. Dropping `conn` cancels the connection
    // before any request goes out.
    let via_local_proxy = conn.used_local_proxy().await;
    attempt.finish(via_local_proxy);
    if via_local_proxy {
        return Err(io::Error::other(format!(
            "could not connect to {host}:{port} without the system proxy, which may be Yaak Proxy"
        )));
    }
    Ok(NwStream {
        remote_addr: conn.remote_addr(),
        conn,
        shared: Arc::default(),
        buffered: Bytes::new(),
        eof: false,
        read_error: None,
        fin_sent: false,
    })
}

/// Whether `host`, from a proxy endpoint, names this Mac.
fn is_local_host(host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']').trim_end_matches('.');
    host.eq_ignore_ascii_case("localhost")
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// Whether the proxy endpoint `endpoint` (an `nw_endpoint_t`) is on this Mac. One that can't be
/// read counts as local. Private Relay's proxies are remote hosts.
///
/// # Safety
/// `endpoint` is a live `nw_endpoint_t`.
unsafe fn is_local_endpoint(endpoint: NwObject) -> bool {
    // SAFETY: strings and addresses from the endpoint live as long as it does.
    unsafe {
        let text = |s: *const c_char| (!s.is_null()).then(|| CStr::from_ptr(s).to_string_lossy());
        match nw_endpoint_get_type(endpoint) {
            ENDPOINT_TYPE_ADDRESS => socket_addr(nw_endpoint_get_address(endpoint))
                .is_none_or(|addr| addr.ip().is_loopback()),
            ENDPOINT_TYPE_HOST => {
                text(nw_endpoint_get_hostname(endpoint)).is_none_or(|h| is_local_host(&h))
            }
            ENDPOINT_TYPE_URL => text(nw_endpoint_get_url(endpoint))
                .and_then(|url| url.parse::<Uri>().ok())
                .and_then(|uri| uri.host().map(is_local_host))
                .unwrap_or(true),
            _ => true,
        }
    }
}

/// The address a plain-HTTP response came from, in its extensions.
#[derive(Clone, Copy, Debug)]
pub(crate) struct RemoteAddr(pub(crate) SocketAddr);

/// Connects hyper-util's client to plain-HTTP origins through [`connect`].
#[derive(Clone, Copy, Default)]
pub(crate) struct Connector;

impl tower_service::Service<Uri> for Connector {
    type Response = NwIo;
    type Error = io::Error;
    type Future = Pin<Box<dyn Future<Output = io::Result<NwIo>> + Send>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, uri: Uri) -> Self::Future {
        Box::pin(async move {
            let invalid = |message| io::Error::new(io::ErrorKind::InvalidInput, message);
            if uri.scheme() != Some(&Scheme::HTTP) {
                return Err(invalid("invalid URL, scheme is not http"));
            }
            let host = uri.host().ok_or_else(|| invalid("invalid URL, host is missing"))?;
            let host = host.trim_start_matches('[').trim_end_matches(']');
            let stream = connect(host, uri.port_u16().unwrap_or(80)).await?;
            Ok(NwIo(TokioIo::new(stream)))
        })
    }
}

/// [`NwStream`] as hyper's IO, reporting where it connected.
pub(crate) struct NwIo(TokioIo<NwStream>);

impl HyperConnection for NwIo {
    fn connected(&self) -> Connected {
        let connected = Connected::new();
        match self.0.inner().remote_addr() {
            Some(addr) => connected.extra(RemoteAddr(addr)),
            None => connected,
        }
    }
}

impl hyper::rt::Read for NwIo {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: hyper::rt::ReadBufCursor<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.0).poll_read(cx, buf)
    }
}

impl hyper::rt::Write for NwIo {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.0).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.0).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.0).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    use super::*;

    const WAIT: Duration = Duration::from_secs(10);

    /// Byte `i` of a test payload: not periodic in any small power of two, so a dropped or
    /// repeated chunk shows.
    fn pattern(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i % 251) as u8).collect()
    }

    async fn listen() -> (TcpListener, SocketAddr) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        (listener, addr)
    }

    async fn accept(listener: &TcpListener) -> TcpStream {
        tokio::time::timeout(WAIT, listener.accept()).await.expect("no connection").unwrap().0
    }

    /// Echoes one connection until the client closes its side, then closes.
    fn spawn_echo(listener: TcpListener) {
        tokio::spawn(async move {
            let mut socket = accept(&listener).await;
            let (mut read, mut write) = socket.split();
            tokio::io::copy(&mut read, &mut write).await.unwrap();
            write.shutdown().await.unwrap();
        });
    }

    #[tokio::test]
    async fn echo_round_trip() {
        let (listener, addr) = listen().await;
        spawn_echo(listener);

        let mut stream = connect("127.0.0.1", addr.port()).await.unwrap();
        assert_eq!(stream.remote_addr(), Some(addr));
        stream.write_all(b"hello").await.unwrap();
        stream.flush().await.unwrap();
        let mut echo = [0u8; 5];
        stream.read_exact(&mut echo).await.unwrap();
        assert_eq!(&echo, b"hello");

        stream.shutdown().await.unwrap();
        let mut rest = Vec::new();
        stream.read_to_end(&mut rest).await.unwrap();
        assert!(rest.is_empty());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn large_transfer_round_trips() {
        let (listener, addr) = listen().await;
        spawn_echo(listener);
        let payload = pattern(16 * 1024 * 1024);

        let stream = connect("127.0.0.1", addr.port()).await.unwrap();
        let (mut read, mut write) = tokio::io::split(stream);
        let sent = payload.clone();
        let writer = tokio::spawn(async move {
            for chunk in sent.chunks(100_000) {
                write.write_all(chunk).await.unwrap();
            }
            write.shutdown().await.unwrap();
        });
        // Read slowly at first, so the echo server's writes back up into ours.
        let mut echoed = Vec::new();
        let mut buf = vec![0u8; 8192];
        for _ in 0..20 {
            let n = read.read(&mut buf).await.unwrap();
            echoed.extend_from_slice(&buf[..n]);
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        tokio::time::timeout(WAIT, read.read_to_end(&mut echoed)).await.unwrap().unwrap();
        writer.await.unwrap();
        assert_eq!(echoed.len(), payload.len());
        assert!(echoed == payload, "echoed bytes differ from the payload");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn writes_wait_while_the_peer_is_not_reading() {
        let (listener, addr) = listen().await;
        let payload = pattern(64 * 1024 * 1024);

        let stream = connect("127.0.0.1", addr.port()).await.unwrap();
        let shared = stream.shared.clone();
        let mut server = accept(&listener).await;
        let sent = payload.clone();
        let mut writer = tokio::spawn(async move {
            let mut stream = stream;
            for chunk in sent.chunks(100_000) {
                stream.write_all(chunk).await.unwrap();
            }
            stream.shutdown().await.unwrap();
        });

        // The server reads nothing yet: once the socket buffers fill, the writer has to wait,
        // with no more than a write's worth past the in-flight limit queued.
        let stalled = tokio::time::timeout(Duration::from_millis(500), &mut writer).await;
        assert!(stalled.is_err(), "64 MB went out with nobody reading");
        let queued = shared.write.lock().unwrap().bytes;
        assert!(queued < MAX_IN_FLIGHT + 100_000, "{queued} bytes queued");

        let mut received = Vec::new();
        tokio::time::timeout(WAIT, server.read_to_end(&mut received)).await.unwrap().unwrap();
        writer.await.unwrap();
        assert_eq!(received.len(), payload.len());
        assert!(received == payload, "received bytes differ from the payload");
    }

    #[tokio::test]
    async fn server_half_close_leaves_the_write_side_open() {
        let (listener, addr) = listen().await;
        let (got_tx, got_rx) = oneshot::channel();
        tokio::spawn(async move {
            let mut socket = accept(&listener).await;
            socket.write_all(b"bye").await.unwrap();
            socket.shutdown().await.unwrap();
            let mut got = Vec::new();
            socket.read_to_end(&mut got).await.unwrap();
            let _ = got_tx.send(got);
        });

        let mut stream = connect("127.0.0.1", addr.port()).await.unwrap();
        let mut got = Vec::new();
        tokio::time::timeout(WAIT, stream.read_to_end(&mut got)).await.unwrap().unwrap();
        assert_eq!(got, b"bye");
        // Reads stay at end of stream.
        assert_eq!(stream.read(&mut [0u8; 8]).await.unwrap(), 0);

        stream.write_all(b"still here").await.unwrap();
        stream.shutdown().await.unwrap();
        let server_got = tokio::time::timeout(WAIT, got_rx).await.unwrap().unwrap();
        assert_eq!(server_got, b"still here");
        let err = stream.write_all(b"late").await.unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::BrokenPipe);
    }

    #[tokio::test]
    async fn dropping_the_stream_closes_the_connection() {
        let (listener, addr) = listen().await;
        let stream = connect("127.0.0.1", addr.port()).await.unwrap();
        let mut server = accept(&listener).await;

        drop(stream);
        let read = tokio::time::timeout(WAIT, server.read(&mut [0u8; 8])).await;
        let read = read.expect("the connection stayed open after the stream was dropped");
        assert!(matches!(read, Ok(0) | Err(_)), "{read:?}");
    }

    #[tokio::test]
    async fn dropping_a_pending_read_cancels_cleanly() {
        let (listener, addr) = listen().await;
        let mut stream = connect("127.0.0.1", addr.port()).await.unwrap();
        let mut server = accept(&listener).await;

        // A receive is still outstanding when the stream goes, and completes after it.
        let mut buf = [0u8; 8];
        let pending = tokio::time::timeout(Duration::from_millis(50), stream.read(&mut buf));
        assert!(pending.await.is_err());
        assert!(stream.shared.read.lock().unwrap().pending);
        drop(stream);
        let read = tokio::time::timeout(WAIT, server.read(&mut [0u8; 8])).await.unwrap();
        assert!(matches!(read, Ok(0) | Err(_)), "{read:?}");
    }

    #[tokio::test]
    async fn refused_connection_is_an_error() {
        let (listener, addr) = listen().await;
        drop(listener);

        let err = tokio::time::timeout(WAIT, connect("127.0.0.1", addr.port()))
            .await
            .expect("a refused connection kept waiting")
            .err()
            .expect("connected to a closed port");
        assert_eq!(err.kind(), io::ErrorKind::ConnectionRefused, "{err}");
    }

    #[tokio::test]
    async fn reset_by_the_server_is_a_read_error() {
        let (listener, addr) = listen().await;
        let mut stream = connect("127.0.0.1", addr.port()).await.unwrap();
        let server = accept(&listener).await;
        server.set_zero_linger().unwrap();
        drop(server);

        let read = tokio::time::timeout(WAIT, stream.read(&mut [0u8; 8])).await.unwrap();
        let err = read.expect_err("a reset connection read cleanly");
        assert_eq!(err.kind(), io::ErrorKind::ConnectionReset, "{err}");
    }

    #[link(name = "Network", kind = "framework")]
    unsafe extern "C" {
        fn nw_privacy_context_create(description: *const c_char) -> NwObject;
        fn nw_privacy_context_add_proxy(privacy_context: NwObject, proxy_config: NwObject);
        fn nw_parameters_set_privacy_context(parameters: NwObject, privacy_context: NwObject);
        fn nw_proxy_config_create_http_connect(endpoint: NwObject, tls: NwObject) -> NwObject;
        fn nw_proxy_config_set_failover_allowed(proxy_config: NwObject, allowed: bool);
    }

    /// Gives `parameters` an HTTP CONNECT proxy at `host:port`, as the system proxy would be, in a
    /// privacy context of their own so no other connection in the process sees it.
    fn use_proxy(parameters: NwObject, host: &str, port: u16) {
        let host = CString::new(host).unwrap();
        let port = CString::new(port.to_string()).unwrap();
        // SAFETY: each object created here is released once, after the parameters retain it.
        unsafe {
            let endpoint = nw_endpoint_create_host(host.as_ptr(), port.as_ptr());
            let config = nw_proxy_config_create_http_connect(endpoint, ptr::null_mut());
            nw_proxy_config_set_failover_allowed(config, true);
            let context = nw_privacy_context_create(c"yaak-proxy test".as_ptr());
            nw_privacy_context_add_proxy(context, config);
            nw_parameters_set_privacy_context(parameters, context);
            nw_release(context);
            nw_release(config);
            nw_release(endpoint);
        }
    }

    /// With no direct route to `target`, "prefer" sends `CONNECT` to the proxy at
    /// `proxy_host`, here standing in for the engine. The connection is refused before a request
    /// goes through it, and the proxy, asking at once as the engine's passthrough tunnel would,
    /// learns that the `CONNECT` is the engine's own.
    async fn assert_local_fallback_is_refused(target: &str, proxy_host: &str) {
        let (proxy, proxy_addr) = listen().await;
        let (seen_tx, seen_rx) = oneshot::channel();
        let own_target = target.to_string();
        tokio::spawn(async move {
            let mut socket = accept(&proxy).await;
            let mut head = Vec::new();
            while !head.ends_with(b"\r\n\r\n") {
                head.push(socket.read_u8().await.unwrap());
            }
            socket.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await.unwrap();
            let own = is_own_fallback(&own_target, 80).await;
            let mut after = Vec::new();
            let _ = socket.read_to_end(&mut after).await;
            let _ = seen_tx.send((head, own, after));
        });

        let port = proxy_addr.port();
        let opened = open(target, 80, |p| use_proxy(p, proxy_host, port));
        let err = tokio::time::timeout(WAIT, opened)
            .await
            .expect("the connection kept waiting")
            .err()
            .expect("connected through the local proxy");
        assert!(err.to_string().contains("without the system proxy"), "{err}");

        let (head, own, after) = tokio::time::timeout(WAIT, seen_rx).await.unwrap().unwrap();
        let head = String::from_utf8_lossy(&head);
        assert!(head.starts_with(&format!("CONNECT {target}:80 ")), "{head}");
        assert!(own, "the CONNECT wasn't recognized as the engine's own");
        assert!(after.is_empty(), "{} bytes went through the proxy", after.len());
        // Tunnels to the target stay refused for a while.
        assert!(is_own_fallback(&target.to_uppercase(), 80).await);
    }

    #[tokio::test]
    async fn fallback_to_a_local_proxy_is_refused() {
        assert_local_fallback_is_refused("yaak-proxy-test.invalid", "127.0.0.1").await;
    }

    #[tokio::test]
    async fn fallback_to_a_proxy_at_localhost_with_a_dot_is_refused() {
        assert_local_fallback_is_refused("yaak-proxy-test-dot.invalid", "localhost.").await;
    }

    #[tokio::test]
    async fn direct_connection_is_not_an_own_fallback() {
        let (listener, addr) = listen().await;
        spawn_echo(listener);
        let stream = connect("localhost", addr.port()).await.unwrap();
        assert!(!is_own_fallback("localhost", addr.port()).await);
        drop(stream);
        assert!(!is_own_fallback("localhost", addr.port()).await);
    }

    /// Opens of the same target that never finish, perhaps other clients' to a slow host, hold a
    /// new tunnel up for one wait in all, not one each.
    #[tokio::test]
    async fn pending_opens_are_waited_for_together() {
        const HOST: &str = "yaak-proxy-test-pending.invalid";
        let guards: Vec<_> = (0..3).map(|_| AttemptGuard::start(HOST, 80)).collect();

        let started = std::time::Instant::now();
        assert!(!is_own_fallback(HOST, 80).await);
        let waited = started.elapsed();
        assert!(waited >= OWN_FALLBACK_WAIT, "{waited:?}");
        assert!(waited < OWN_FALLBACK_WAIT * 3 / 2, "{waited:?}");
        drop(guards);
    }

    /// The first open through a local proxy answers, whatever the others are doing.
    #[tokio::test]
    async fn an_own_fallback_among_pending_opens_answers_at_once() {
        const HOST: &str = "yaak-proxy-test-own-among-pending.invalid";
        let slow = [AttemptGuard::start(HOST, 80), AttemptGuard::start(HOST, 80)];
        let own = AttemptGuard::start(HOST, 80);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            own.finish(true);
        });

        let started = std::time::Instant::now();
        assert!(is_own_fallback(HOST, 80).await);
        assert!(started.elapsed() < OWN_FALLBACK_WAIT / 2, "{:?}", started.elapsed());
        drop(slow);
    }

    #[test]
    fn local_proxy_hosts() {
        for host in [
            "localhost",
            "LOCALHOST",
            "localhost.",
            "127.0.0.1",
            "127.8.9.1",
            "::1",
            "[::1]",
        ] {
            assert!(is_local_host(host), "{host}");
        }
        for host in [
            "cp4.cloudflare.com",
            "10.0.0.1",
            "192.168.4.44",
            "::ffff:8.8.8.8",
            "",
        ] {
            assert!(!is_local_host(host), "{host}");
        }
    }

    #[tokio::test]
    async fn host_with_a_nul_is_invalid() {
        let err = connect("exa\0mple.com", 80).await.err().unwrap();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }
}
