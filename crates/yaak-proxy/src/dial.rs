//! The connection to the server of a CONNECT, opened before the CONNECT is answered, so a server
//! that can't be reached fails the CONNECT itself and the client reports its own connection
//! error, as it would without the proxy.

use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use hyper::StatusCode;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;

/// The longest the dial before answering a CONNECT may take, name lookup included. The system's
/// own limit is over a minute.
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// A TCP connection to a server: a socket, or on macOS for port 80 a Network.framework
/// connection, which skips the system proxy as [`crate::tunnel::tunnel`] does there.
pub(crate) enum UpstreamIo {
    Tcp(TcpStream),
    #[cfg(target_os = "macos")]
    Nw(crate::nw::NwStream),
}

impl UpstreamIo {
    pub(crate) fn remote_addr(&self) -> Option<SocketAddr> {
        match self {
            Self::Tcp(tcp) => tcp.peer_addr().ok(),
            #[cfg(target_os = "macos")]
            Self::Nw(nw) => nw.remote_addr(),
        }
    }
}

/// A connection opened as its CONNECT came in, and how long opening it took.
pub(crate) struct Dialled {
    pub(crate) io: UpstreamIo,
    pub(crate) took: Duration,
}

/// Opens the connection to `host:port` for a CONNECT, within [`CONNECT_TIMEOUT`]. `host` is as
/// the CONNECT named it, an IPv6 address in brackets.
pub(crate) async fn dial(host: &str, port: u16) -> Result<Dialled, Unreachable> {
    let start = Instant::now();
    let deadline = tokio::time::Instant::now() + CONNECT_TIMEOUT;
    let io = match tokio::time::timeout_at(deadline, open(host, port, deadline)).await {
        Ok(io) => io?,
        Err(_) => return Err(Unreachable::of(&timed_out(), false)),
    };
    Ok(Dialled { io, took: start.elapsed() })
}

fn timed_out() -> io::Error {
    let message = format!("no connection after {} seconds", CONNECT_TIMEOUT.as_secs());
    io::Error::new(io::ErrorKind::TimedOut, message)
}

async fn open(
    host: &str,
    port: u16,
    deadline: tokio::time::Instant,
) -> Result<UpstreamIo, Unreachable> {
    #[cfg(target_os = "macos")]
    if port == 80 {
        let host = host.trim_start_matches('[').trim_end_matches(']');
        return crate::nw::connect(host, port)
            .await
            .map(UpstreamIo::Nw)
            .map_err(|e| Unreachable::of(&e, crate::nw::is_lookup_failure(&e)));
    }
    // Looked up apart from connecting, so a failure is known to be the lookup's.
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host(format!("{host}:{port}"))
        .await
        .map_err(|e| Unreachable::of(&e, true))?
        .collect();
    if addrs.is_empty() {
        let e = io::Error::new(io::ErrorKind::NotFound, "no address for the host");
        return Err(Unreachable::of(&e, true));
    }
    connect_any(&addrs, deadline).await.map(UpstreamIo::Tcp).map_err(|e| Unreachable::of(&e, false))
}

/// Connects to the first of `addrs` that answers, in turn, each given an even share of the time
/// left before `deadline`, so one that never answers (a broken IPv6 route, say) leaves time for
/// the rest. Fails with the last address's error.
async fn connect_any(
    addrs: &[SocketAddr],
    deadline: tokio::time::Instant,
) -> io::Result<TcpStream> {
    let mut last = None;
    for (i, addr) in addrs.iter().enumerate() {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        let share = left / (addrs.len() - i) as u32;
        match tokio::time::timeout(share, TcpStream::connect(addr)).await {
            Ok(Ok(tcp)) => return Ok(tcp),
            Ok(Err(e)) => last = Some(e),
            Err(_) => last = Some(timed_out()),
        }
    }
    Err(last.unwrap_or_else(timed_out))
}

/// Whether a CONNECT to `host:port` may be one of the engine's own connections coming back
/// through the system proxy. Its loop guard can only tell once the CONNECT is answered, as the
/// open that sent it finishes then, so such a CONNECT is answered before its server is dialled,
/// and the tunnel's guard runs after. Only port 80 on macOS can be one. Does not wait.
pub(crate) fn may_be_own_connection(host: &str, port: u16) -> bool {
    #[cfg(target_os = "macos")]
    if port == 80 {
        let host = host.trim_start_matches('[').trim_end_matches(']');
        return crate::nw::has_attempts(host, port);
    }
    let _ = (host, port);
    false
}

/// Why a CONNECT's server could not be reached: what is said of it, and the system's error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Unreachable {
    pub(crate) kind: UnreachableKind,
    pub(crate) error: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UnreachableKind {
    Lookup,
    Refused,
    HostUnreachable,
    NetworkUnreachable,
    TimedOut,
    Other,
}

impl Unreachable {
    /// Classifies `e`, from looking the host up when `lookup` is set, or else from connecting.
    pub(crate) fn of(e: &io::Error, lookup: bool) -> Self {
        use io::ErrorKind::{ConnectionRefused, HostUnreachable, NetworkUnreachable, TimedOut};
        let kind = if lookup {
            UnreachableKind::Lookup
        } else {
            match e.kind() {
                ConnectionRefused => UnreachableKind::Refused,
                HostUnreachable => UnreachableKind::HostUnreachable,
                NetworkUnreachable => UnreachableKind::NetworkUnreachable,
                TimedOut => UnreachableKind::TimedOut,
                _ => UnreachableKind::Other,
            }
        };
        Self { kind, error: e.to_string() }
    }

    /// The reason in plain words.
    pub(crate) fn reason(&self) -> &'static str {
        match self.kind {
            UnreachableKind::Lookup => "DNS lookup failed",
            UnreachableKind::Refused => "Connection refused",
            UnreachableKind::HostUnreachable => "Host unreachable",
            UnreachableKind::NetworkUnreachable => "Network unreachable",
            UnreachableKind::TimedOut => "Timed out",
            UnreachableKind::Other => "Connection failed",
        }
    }

    /// The CONNECT's answer: a gateway timeout for a timeout, a bad gateway otherwise.
    pub(crate) fn status(&self) -> StatusCode {
        match self.kind {
            UnreachableKind::TimedOut => StatusCode::GATEWAY_TIMEOUT,
            _ => StatusCode::BAD_GATEWAY,
        }
    }
}

/// The reason, then the system's error.
impl std::fmt::Display for Unreachable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.reason(), self.error)
    }
}

impl AsyncRead for UpstreamIo {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.get_mut() {
            Self::Tcp(s) => Pin::new(s).poll_read(cx, buf),
            #[cfg(target_os = "macos")]
            Self::Nw(s) => Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for UpstreamIo {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        match self.get_mut() {
            Self::Tcp(s) => Pin::new(s).poll_write(cx, buf),
            #[cfg(target_os = "macos")]
            Self::Nw(s) => Pin::new(s).poll_write(cx, buf),
        }
    }

    /// Passed through, so TLS records leave in one write rather than one each, which Nagle's
    /// algorithm would hold for the server's delayed ACK.
    fn poll_write_vectored(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        match self.get_mut() {
            Self::Tcp(s) => Pin::new(s).poll_write_vectored(cx, bufs),
            #[cfg(target_os = "macos")]
            Self::Nw(s) => Pin::new(s).poll_write_vectored(cx, bufs),
        }
    }

    fn is_write_vectored(&self) -> bool {
        match self {
            Self::Tcp(s) => s.is_write_vectored(),
            #[cfg(target_os = "macos")]
            Self::Nw(s) => s.is_write_vectored(),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            Self::Tcp(s) => Pin::new(s).poll_flush(cx),
            #[cfg(target_os = "macos")]
            Self::Nw(s) => Pin::new(s).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            Self::Tcp(s) => Pin::new(s).poll_shutdown(cx),
            #[cfg(target_os = "macos")]
            Self::Nw(s) => Pin::new(s).poll_shutdown(cx),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classify(kind: io::ErrorKind, lookup: bool) -> (UnreachableKind, &'static str, u16) {
        let unreachable = Unreachable::of(&io::Error::new(kind, "system error"), lookup);
        (unreachable.kind, unreachable.reason(), unreachable.status().as_u16())
    }

    #[test]
    fn failures_are_classified_by_kind() {
        use UnreachableKind as K;
        use io::ErrorKind::*;
        assert_eq!(classify(ConnectionRefused, false), (K::Refused, "Connection refused", 502));
        assert_eq!(classify(HostUnreachable, false), (K::HostUnreachable, "Host unreachable", 502));
        assert_eq!(
            classify(NetworkUnreachable, false),
            (K::NetworkUnreachable, "Network unreachable", 502)
        );
        assert_eq!(classify(TimedOut, false), (K::TimedOut, "Timed out", 504));
        assert_eq!(classify(ConnectionReset, false), (K::Other, "Connection failed", 502));
    }

    /// Whatever the lookup's error looks like, it failed to find the host.
    #[test]
    fn a_lookup_failure_is_dns_whatever_its_kind() {
        for kind in [
            io::ErrorKind::Other,
            io::ErrorKind::NotFound,
            io::ErrorKind::TimedOut,
        ] {
            assert_eq!(classify(kind, true), (UnreachableKind::Lookup, "DNS lookup failed", 502));
        }
    }

    #[test]
    fn the_text_is_the_reason_then_the_systems_error() {
        let e = io::Error::from(io::ErrorKind::ConnectionRefused);
        let text = Unreachable::of(&e, false).to_string();
        assert_eq!(text, format!("Connection refused: {e}"));
    }

    /// A name under `.invalid` never resolves (RFC 2606).
    #[tokio::test]
    async fn an_invalid_name_is_a_dns_failure() {
        let Err(unreachable) = dial("yaak-proxy-dial.invalid", 443).await else {
            panic!("an .invalid name resolved");
        };
        assert_eq!(unreachable.kind, UnreachableKind::Lookup, "{unreachable}");
    }

    /// An address that never answers gets its share of the time, and the next is tried.
    #[tokio::test]
    async fn an_address_that_never_answers_leaves_time_for_the_next() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let reachable = listener.local_addr().unwrap();
        // Reserved for documentation (RFC 5737), so nothing answers there.
        let silent: SocketAddr = "192.0.2.1:9".parse().unwrap();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        let tcp = connect_any(&[silent, reachable], deadline).await.unwrap();
        assert_eq!(tcp.peer_addr().unwrap(), reachable);
    }

    /// Without vectored writes, TLS sends each record on its own, and a small one waits on
    /// Nagle's algorithm for the server's delayed ACK: some 40 ms on every request.
    #[tokio::test]
    async fn writes_stay_vectored() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let dialled = dial("127.0.0.1", addr.port()).await.unwrap();
        assert!(dialled.io.is_write_vectored());
    }

    #[tokio::test]
    async fn a_closed_port_is_refused() {
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = closed.local_addr().unwrap().port();
        drop(closed);
        let Err(unreachable) = dial("127.0.0.1", port).await else {
            panic!("connected to a closed port");
        };
        assert_eq!(unreachable.kind, UnreachableKind::Refused, "{unreachable}");
    }
}
