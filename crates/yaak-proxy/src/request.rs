use std::convert::Infallible;
use std::error::Error;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime};

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Body;
use hyper::body::Incoming;
use hyper::client::conn::TrySendError;
use hyper::header::{
    CONTENT_LENGTH, CONTENT_TYPE, COOKIE, HOST, HeaderValue, TRANSFER_ENCODING, UPGRADE, VIA,
};
use hyper::http::request::Parts;
use hyper::http::uri::{Authority, PathAndQuery, Scheme};
use hyper::upgrade::OnUpgrade;
use hyper::{Method, Request, Response, StatusCode, Uri};
use hyper_util::rt::{TokioExecutor, TokioIo};
use log::{debug, info, warn};
use rustls::pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite};
use tokio::net::TcpStream;
use tokio_rustls::{LazyConfigAcceptor, TlsConnector};

use crate::body::{BodyParser, CaptureBody, Direction};
use crate::connection::{Reset, ResetHandle, serve_tls};
use crate::decrypt::Verdict;
use crate::dial::{self, Dialled, UpstreamIo};
use crate::grpc::{self, GrpcParser};
use crate::messages::{MessageDirection, StreamKind};
use crate::sse::SseParser;
use crate::tunnel::{Counted, Rewind, is_own_connection, relay, splice, tunnel};
use crate::ws::{self, WsFlow};
use crate::{ClientConn, Engine, ProxyEvent, TunnelReason};

pub(crate) type BoxBody = http_body_util::combinators::BoxBody<Bytes, hyper::Error>;
type BoxError = Box<dyn Error + Send + Sync>;

const TLS_HANDSHAKE_RECORD: u8 = 0x16;
/// TLS clients send their ClientHello as soon as CONNECT succeeds; protocols where the server
/// speaks first (SMTP, for one) send nothing, so after this they are tunneled blind.
const CLIENT_FIRST_BYTES_TIMEOUT: Duration = Duration::from_secs(1);

fn text_body(text: impl Into<Bytes>) -> BoxBody {
    Full::new(text.into()).map_err(|never| match never {}).boxed()
}

fn version_str(v: hyper::Version) -> String {
    match v {
        hyper::Version::HTTP_09 => "HTTP/0.9",
        hyper::Version::HTTP_10 => "HTTP/1.0",
        hyper::Version::HTTP_11 => "HTTP/1.1",
        hyper::Version::HTTP_2 => "HTTP/2",
        hyper::Version::HTTP_3 => "HTTP/3",
        _ => "unknown",
    }
    .to_string()
}

fn error_chain(e: &(dyn Error + 'static)) -> String {
    let mut message = e.to_string();
    let mut source = e.source();
    while let Some(s) = source {
        message.push_str(": ");
        message.push_str(&s.to_string());
        source = s.source();
    }
    message
}

fn header_str<'a>(headers: &'a hyper::HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

/// A gRPC call, from its request headers.
struct GrpcCall {
    /// gRPC-Web's base64 flavor.
    text: bool,
    /// What the client's compressed messages are compressed with.
    encoding: Option<String>,
    /// The request body's `Content-Encoding`, which gRPC-Web may use.
    content_encoding: Option<String>,
}

/// Per-flow bookkeeping shared by the plain HTTP and the intercepted HTTPS paths.
struct Flow {
    id: u64,
    start: Instant,
    engine: Arc<Engine>,
    /// It has answered the client, so dropping it is no cancel.
    answered: bool,
    /// Reading the client's upload failed: it reset the stream or closed the connection.
    upload_failed: Arc<AtomicBool>,
    grpc: Option<GrpcCall>,
}

impl Flow {
    fn begin(
        engine: Arc<Engine>,
        client: ClientConn,
        req: &Request<Incoming>,
        url: String,
    ) -> Self {
        let mut flow = Self {
            id: engine.next_flow_id(),
            start: Instant::now(),
            engine,
            answered: false,
            upload_failed: Arc::new(AtomicBool::new(false)),
            grpc: None,
        };
        flow.engine.emit(ProxyEvent::RequestStart {
            id: flow.id,
            started_at: SystemTime::now(),
            method: req.method().to_string(),
            url,
            http_version: version_str(req.version()),
            connection: client.connection,
            client_addr: client.addr,
        });
        // HTTP/2 carries the host in `:authority`, which hyper keeps in the URI. Shown as `Host`,
        // as HTTP/1.1 requests have it.
        if req.version() == hyper::Version::HTTP_2
            && !req.headers().contains_key(HOST)
            && let Some(authority) = req.uri().authority()
        {
            flow.engine.emit(ProxyEvent::RequestHeader {
                id: flow.id,
                name: HOST.to_string(),
                value: authority.to_string(),
            });
        }
        for (name, value) in req.headers() {
            flow.engine.emit(ProxyEvent::RequestHeader {
                id: flow.id,
                name: name.to_string(),
                value: String::from_utf8_lossy(value.as_bytes()).into_owned(),
            });
        }
        if let Some((kind, text)) = grpc::detect(header_str(req.headers(), "content-type")) {
            flow.engine.emit(ProxyEvent::StreamStart { id: flow.id, kind });
            let encoding = header_str(req.headers(), "grpc-encoding").map(String::from);
            let content_encoding = header_str(req.headers(), "content-encoding").map(String::from);
            flow.grpc = Some(GrpcCall { text, encoding, content_encoding });
        }
        flow
    }

    fn capture_request(&self, body: Incoming) -> BoxBody {
        let parser = self.grpc.as_ref().map(|call| {
            let limit = self.engine.capture_body_limit();
            let encoding = call.encoding.as_deref();
            let parser = GrpcParser::new(MessageDirection::Client, encoding, call.text, limit)
                .with_content_encoding(call.content_encoding.as_deref());
            BodyParser::Grpc(parser)
        });
        CaptureBody::new(body, Direction::Request, self.id, self.start, self.engine.clone())
            .flag_failure(self.upload_failed.clone())
            .with_parser(parser)
            .boxed()
    }

    /// How the response's body is read for messages, if it streams them, after recording that
    /// it does.
    fn response_parser(&self, resp: &Response<Incoming>) -> Option<BodyParser> {
        let limit = self.engine.capture_body_limit();
        let headers = resp.headers();
        if self.grpc.is_some() {
            // A call that fails at once answers with its status in the headers, and no body.
            if let Some(message) = grpc::trailers_from_headers(headers) {
                self.engine.emit(ProxyEvent::Message { id: self.id, message });
            }
            // A gateway's own error page is no gRPC body.
            let (_, text) = grpc::detect(header_str(headers, "content-type"))?;
            let encoding = header_str(headers, "grpc-encoding");
            let parser = GrpcParser::new(MessageDirection::Server, encoding, text, limit)
                .with_content_encoding(header_str(headers, "content-encoding"));
            return Some(BodyParser::Grpc(parser));
        }
        let content_type = header_str(headers, "content-type").unwrap_or_default();
        let essence = content_type.split(';').next().unwrap_or_default().trim();
        if !essence.eq_ignore_ascii_case("text/event-stream") {
            return None;
        }
        self.engine.emit(ProxyEvent::StreamStart { id: self.id, kind: StreamKind::Sse });
        let encoding = header_str(headers, "content-encoding");
        Some(BodyParser::Sse(Box::new(SseParser::new(encoding, limit))))
    }

    /// Records the connection the request goes on: its timings when it was opened for this
    /// request, and its TLS either way. One opened as the CONNECT came in is charged to its
    /// first request as if opened just before it: the flow's times count from that much earlier.
    fn goes_on(&mut self, conn: &UpstreamConn, reused: bool) {
        let ms = |d: Duration| d.as_millis() as u64;
        let (connect, tls) = if reused {
            (None, None)
        } else {
            if let Some(took) = conn.tls.dialled_before {
                self.start = self.start.checked_sub(took).unwrap_or(self.start);
            }
            let connect = match conn.tls.dialled_before {
                Some(took) => took,
                None => conn.tls.connected.saturating_duration_since(self.start),
            };
            (Some(ms(connect)), Some(ms(conn.tls.handshaken.saturating_duration_since(self.start))))
        };
        self.engine.emit(ProxyEvent::UpstreamConnection {
            id: self.id,
            elapsed_connect_ms: connect,
            elapsed_tls_ms: tls,
            tls_version: conn.tls.version.clone(),
            tls_cipher: conn.tls.cipher.clone(),
        });
    }

    fn respond_head(&mut self, resp: &Response<Incoming>, remote_addr: Option<SocketAddr>) {
        self.answered = true;
        self.engine.emit(ProxyEvent::ResponseStart {
            id: self.id,
            status: resp.status().as_u16(),
            http_version: version_str(resp.version()),
            remote_addr,
            elapsed_ms: self.start.elapsed().as_millis() as u64,
        });
        for (name, value) in resp.headers() {
            self.engine.emit(ProxyEvent::ResponseHeader {
                id: self.id,
                name: name.to_string(),
                value: String::from_utf8_lossy(value.as_bytes()).into_owned(),
            });
        }
    }

    fn respond(
        mut self,
        resp: Response<Incoming>,
        remote_addr: Option<SocketAddr>,
    ) -> Response<BoxBody> {
        self.respond_head(&resp, remote_addr);
        let parser = self.response_parser(&resp);
        let (parts, body) = resp.into_parts();
        let engine = self.engine.clone();
        let body = CaptureBody::new(body, Direction::Response, self.id, self.start, engine)
            .with_parser(parser);
        Response::from_parts(parts, body.boxed())
    }

    /// Answers with a WebSocket's `101`. The flow goes on in the returned [`WsFlow`], which
    /// ends it, as the `101` has no body to.
    fn respond_websocket(
        mut self,
        resp: Response<Incoming>,
        remote_addr: Option<SocketAddr>,
    ) -> (Response<BoxBody>, Arc<WsFlow>) {
        self.respond_head(&resp, remote_addr);
        self.engine.emit(ProxyEvent::StreamStart { id: self.id, kind: StreamKind::WebSocket });
        let ws = Arc::new(WsFlow::new(self.id, self.start, self.engine.clone()));
        let (parts, body) = resp.into_parts();
        (Response::from_parts(parts, body.boxed()), ws)
    }

    /// Answers the client with `status` and `error` without contacting any server.
    fn reject(mut self, status: StatusCode, error: &str) -> Response<BoxBody> {
        self.answered = true;
        debug!("Flow {} rejected: {error}", self.id);
        self.engine.emit(ProxyEvent::Error {
            id: self.id,
            error: error.to_string(),
            elapsed_ms: self.start.elapsed().as_millis() as u64,
        });
        Response::builder()
            .status(status)
            .header(CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(text_body(error.to_string()))
            .unwrap()
    }

    /// Ends the flow as an error, its server unreachable, and resets the client's connection
    /// unanswered, so the client reports a connection error of its own, as it would without the
    /// proxy. A response of the engine's would look the server's.
    fn unreachable(mut self, unreachable: &dial::Unreachable, conn: &ResetHandle) -> Reset {
        self.answered = true;
        let error = unreachable.to_string();
        debug!("Flow {} could not reach the server: {error}", self.id);
        self.engine.emit(ProxyEvent::Error {
            id: self.id,
            error,
            elapsed_ms: self.start.elapsed().as_millis() as u64,
        });
        conn.reset()
    }

    fn fail(mut self, error: String) -> Response<BoxBody> {
        // The request failed because the client stopped sending its body: it cancelled. The
        // answer goes nowhere, and dropping the flow unanswered says so.
        if self.upload_failed.load(Ordering::Relaxed) {
            debug!("Flow {} upload ended by the client: {error}", self.id);
            return bad_gateway(error);
        }
        self.answered = true;
        debug!("Flow {} failed: {error}", self.id);
        let body = format!("Yaak Proxy could not reach the server: {error}");
        self.engine.emit(ProxyEvent::Error {
            id: self.id,
            error,
            elapsed_ms: self.start.elapsed().as_millis() as u64,
        });
        bad_gateway(body)
    }
}

/// A flow dropped before it answered was abandoned by the client, which reset its stream or
/// closed the connection: hyper drops the request's future, and the request upstream with it.
impl Drop for Flow {
    fn drop(&mut self) {
        if !self.answered {
            debug!("Flow {} cancelled by the client", self.id);
            self.engine.emit(ProxyEvent::Cancelled {
                id: self.id,
                elapsed_ms: self.start.elapsed().as_millis() as u64,
            });
        }
    }
}

fn bad_gateway(body: String) -> Response<BoxBody> {
    Response::builder().status(StatusCode::BAD_GATEWAY).body(text_body(body)).unwrap()
}

/// Serves a request to the listener. A plain HTTP request whose server can't be reached resets
/// the client's connection through `conn`, failing with the [`Reset`].
pub(crate) async fn handle_request(
    mut req: Request<Incoming>,
    client: ClientConn,
    engine: Arc<Engine>,
    conn: ResetHandle,
) -> Result<Response<BoxBody>, Reset> {
    if req.method() == Method::CONNECT {
        return Ok(handle_connect(req, client, engine).await);
    }

    // A request the engine sent that was routed back to it, as iCloud Private Relay does with
    // port 80 while the system proxy is on: forwarding it again would loop forever. It is the
    // engine's own copy of a flow already recorded, which gets this answer, so it records none.
    if carries_via(&req, &engine) {
        debug!("Refused {} {}: it looped back to Yaak Proxy", req.method(), req.uri());
        return Ok(Response::builder()
            .status(StatusCode::LOOP_DETECTED)
            .header(CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(text_body("request looped back to Yaak Proxy"))
            .unwrap());
    }

    // Some clients send a bare path (`POST /api`) as they would to the server itself.
    let from_host = req.uri().authority().is_none();
    let rejected = if from_host { url_from_host(&mut req).err() } else { None };
    let flow = Flow::begin(engine.clone(), client, &req, req.uri().to_string());
    if let Some((status, error)) = rejected {
        return Ok(flow.reject(status, error));
    }
    req.headers_mut().append(VIA, engine.via.clone());

    let (parts, body) = req.into_parts();
    let outgoing = Request::from_parts(parts, flow.capture_request(body));
    match engine.http_client.request(outgoing).await {
        Ok(resp) => {
            let remote_addr = resp.extensions().get::<dial::RemoteAddr>().map(|a| a.0);
            Ok(flow.respond(resp, remote_addr))
        }
        Err(e) => match dial::unreachable_of(&e) {
            Some(unreachable) => Err(flow.unreachable(unreachable, &conn)),
            None => Ok(flow.fail(error_chain(&e))),
        },
    }
}

/// Whether `req` carries this engine's `Via` mark, which it adds to every plain-HTTP request it
/// forwards.
fn carries_via(req: &Request<Incoming>, engine: &Engine) -> bool {
    let via = engine.via.to_str().unwrap_or_default();
    req.headers()
        .get_all(VIA)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .any(|v| v.split(',').any(|hop| hop.trim() == via))
}

/// Gives a bare-path request the `http://` URL its `Host` names. Fails when there is no usable
/// `Host`.
fn url_from_host(req: &mut Request<Incoming>) -> Result<(), (StatusCode, &'static str)> {
    let Some(host) = req.headers().get(HOST) else {
        return Err((StatusCode::BAD_REQUEST, "no host in request"));
    };
    let Some(authority) = host.to_str().ok().and_then(|h| h.parse::<Authority>().ok()) else {
        return Err((StatusCode::BAD_REQUEST, "invalid host in request"));
    };
    let mut parts = std::mem::take(req.uri_mut()).into_parts();
    parts.scheme = Some(Scheme::HTTP);
    parts.authority = Some(authority);
    if parts.path_and_query.is_none() {
        parts.path_and_query = Some(PathAndQuery::from_static("/"));
    }
    *req.uri_mut() =
        Uri::from_parts(parts).map_err(|_| (StatusCode::BAD_REQUEST, "invalid host in request"))?;
    Ok(())
}

/// Where an intercepted CONNECT tunnel leads.
struct Target {
    /// Host for the leaf certificate and upstream SNI.
    server_name: String,
    /// `host[:port]` as it appears in captured URLs.
    authority: String,
    /// `host:port` to dial.
    addr: String,
    port: u16,
}

/// Answers a CONNECT once its server is reached, with the connection handed on to the tunnel or
/// the first request, or with a 502 or 504 when it can't be, so the client reports a connection
/// error of its own.
async fn handle_connect(
    req: Request<Incoming>,
    client: ClientConn,
    engine: Arc<Engine>,
) -> Response<BoxBody> {
    let Some(authority) = req.uri().authority().cloned() else {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(text_body("CONNECT requires host:port"))
            .unwrap();
    };
    let host = authority.host().to_string();
    let port = authority.port_u16().unwrap_or(443);
    let target = Target {
        server_name: host.trim_start_matches('[').trim_end_matches(']').to_string(),
        authority: if port == 443 { host.clone() } else { format!("{host}:{port}") },
        addr: format!("{host}:{port}"),
        port,
    };

    // One that may be the engine's own connection coming back is answered first, as its loop
    // guard can only tell once it is, and is dialled behind that guard.
    let dialled = if dial::may_be_own_connection(&host, port) {
        None
    } else {
        let (started_at, start) = (SystemTime::now(), Instant::now());
        match dial::dial(&host, port).await {
            Ok(dialled) => Some(dialled),
            Err(unreachable) => {
                return refuse_connect(&engine, &target, client, &unreachable, started_at, start);
            }
        }
    };

    tokio::spawn(async move {
        let upgraded = match hyper::upgrade::on(req).await {
            Ok(u) => TokioIo::new(u),
            Err(e) => return warn!("CONNECT upgrade failed for {host}: {e}"),
        };
        if let Err(e) = intercept(upgraded, target, dialled, client, engine).await {
            debug!("Tunnel to {host}:{port} ended: {}", error_chain(e.as_ref()));
        }
    });

    Response::new(text_body(Bytes::new()))
}

/// Records a CONNECT whose server could not be reached as a flow of its own, and answers it.
fn refuse_connect(
    engine: &Engine,
    target: &Target,
    conn: ClientConn,
    unreachable: &dial::Unreachable,
    started_at: SystemTime,
    start: Instant,
) -> Response<BoxBody> {
    let error = unreachable.to_string();
    debug!("Could not connect to {}: {error}", target.addr);
    engine.emit(ProxyEvent::ConnectFailed {
        id: engine.next_flow_id(),
        started_at,
        authority: target.authority.clone(),
        connection: conn.connection,
        client_addr: conn.addr,
        error: error.clone(),
        elapsed_ms: start.elapsed().as_millis() as u64,
    });
    Response::builder()
        .status(unreachable.status())
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(text_body(format!("Yaak Proxy could not connect to {}: {error}", target.addr)))
        .unwrap()
}

/// Judges an answered CONNECT and serves it: tunnelled, or decrypted. `dialled` is its server's
/// connection, opened before the CONNECT was answered; without it, the server is dialled here.
async fn intercept<S>(
    mut client: S,
    target: Target,
    dialled: Option<Dialled>,
    conn: ClientConn,
    engine: Arc<Engine>,
) -> Result<(), BoxError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let reason = match engine.verdict(&target.server_name, target.port, conn.connection).await {
        Verdict::Decrypt => None,
        Verdict::NotListed => {
            debug!("Tunneling {} undecrypted, as the decrypt list leaves it out", target.addr);
            Some(TunnelReason::NotListed)
        }
        Verdict::Excluded(entry) => {
            debug!("Tunneling {} undecrypted, as {entry} excludes it", target.addr);
            Some(TunnelReason::Excluded { entry: entry.to_string(), built_in: entry.built_in })
        }
    };
    // The fallback for clients that rejected the engine's certificate.
    let reason = reason.or_else(|| {
        engine
            .passthrough_of(&target.addr)
            .map(|rejected_by| TunnelReason::Rejected { rejected_by })
    });
    if let Some(reason) = reason {
        let upstream = dialled.map(|d| d.io);
        return Ok(tunnel_flow(client, &target, upstream, conn, &engine, reason).await?);
    }

    let mut buf = vec![0u8; 4096];
    let Ok(n) = tokio::time::timeout(CLIENT_FIRST_BYTES_TIMEOUT, client.read(&mut buf)).await
    else {
        debug!("Client sent nothing, tunneling server-first traffic to {}", target.addr);
        return Ok(tunnel_to(client, &target, dialled.map(|d| d.io), &[]).await?);
    };
    let n = n?;
    if n == 0 {
        return Ok(());
    }
    buf.truncate(n);
    if buf[0] != TLS_HANDSHAKE_RECORD {
        debug!("Tunneling non-TLS traffic to {}", target.addr);
        return Ok(tunnel_to(client, &target, dialled.map(|d| d.io), &buf).await?);
    }

    let attempt = HandshakeAttempt { started_at: SystemTime::now(), start: Instant::now() };
    let acceptor = rustls::server::Acceptor::default();
    let start = LazyConfigAcceptor::new(acceptor, Rewind::new(Bytes::from(buf), client)).await?;
    let server_name = start
        .client_hello()
        .server_name()
        .map(str::to_string)
        .unwrap_or_else(|| target.server_name.clone());
    let config = engine.ca.server_config(&server_name, engine.offers_http2())?;
    let mut tls = match start.into_stream(config).await {
        Ok(tls) => tls,
        Err(e) => {
            let rejection = certificate_rejection(&e)
                .map(String::from)
                .or_else(|| is_hang_up(&e).then(|| HANG_UP.to_string()));
            let alert = certificate_rejection(&e).is_some();
            record_handshake_failure(&engine, &target, conn, &attempt, alert, rejection, &e);
            return Ok(());
        }
    };

    // SChannel (native-tls on Windows) checks the certificate only after sending its Finished,
    // so it rejects the proxy by hanging up on a completed handshake. Only a request counts as
    // success.
    let mut buf = vec![0u8; 4096];
    let n = match tls.read(&mut buf).await {
        Ok(n) => n,
        Err(e) if is_hang_up(&e) => {
            let rejection = Some(HANG_UP.to_string());
            record_handshake_failure(&engine, &target, conn, &attempt, false, rejection, &e);
            return Ok(());
        }
        Err(e) => return Err(e.into()),
    };
    if n == 0 {
        return Ok(());
    }
    buf.truncate(n);
    engine.record_handshake_success(&target.addr);

    let http2 = tls.get_ref().1.alpn_protocol() == Some(b"h2");
    let tls = Rewind::new(Bytes::from(buf), tls);
    let upstreams = Arc::new(Upstreams::new(Target { server_name, ..target }, dialled));
    serve_tls(tls, http2, move |req| forward_https(req, upstreams.clone(), conn, engine.clone()))
        .await
}

/// Relays `client` to the server over `upstream`, the connection dialled before the CONNECT was
/// answered, or else over a new one, after sending `prefix` (bytes already read from the client).
async fn tunnel_to<S>(
    client: S,
    target: &Target,
    upstream: Option<UpstreamIo>,
    prefix: &[u8],
) -> std::io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    match upstream {
        Some(upstream) => relay(client, upstream, prefix).await,
        None => tunnel(client, &target.addr, prefix).await,
    }
}

/// Tunnels a CONNECT undecrypted, recorded as a flow of its own with the bytes each way. Not
/// one of the engine's own connections coming back, which [`tunnel`] refuses: one that may be
/// was answered without dialling, so has no `upstream`.
async fn tunnel_flow<S>(
    client: S,
    target: &Target,
    upstream: Option<UpstreamIo>,
    conn: ClientConn,
    engine: &Engine,
    reason: TunnelReason,
) -> std::io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    if upstream.is_none() && is_own_connection(&target.addr).await {
        return tunnel(client, &target.addr, &[]).await;
    }
    let id = engine.next_flow_id();
    let start = Instant::now();
    // Registered before its start is announced, so it can be closed as soon as it is known.
    let (close_tx, close_rx) = tokio::sync::oneshot::channel();
    engine.tunnels.lock().unwrap().insert(id, close_tx);
    engine.emit(ProxyEvent::TunnelStart {
        id,
        started_at: SystemTime::now(),
        authority: target.authority.clone(),
        host: target.server_name.clone(),
        port: target.port,
        connection: conn.connection,
        client_addr: conn.addr,
        reason,
    });
    let client = Counted::new(client);
    let (sent, received) = client.counters();
    // Closed on request: dropping the relay closes both sides.
    let (result, reconnect_requested) = tokio::select! {
        result = tunnel_to(client, target, upstream, &[]) => (result, false),
        _ = close_rx => (Ok(()), true),
    };
    engine.tunnels.lock().unwrap().remove(&id);
    let (sent, received) = (sent.load(Ordering::Relaxed), received.load(Ordering::Relaxed));
    // A tunnel that carried the server's bytes and then broke ended as connections do; one that
    // never did failed to reach the server.
    let error = match &result {
        Err(e) if received == 0 => Some(error_chain(e)),
        _ => None,
    };
    engine.emit(ProxyEvent::TunnelEnd {
        id,
        sent,
        received,
        elapsed_ms: start.elapsed().as_millis() as u64,
        error,
        reconnect_requested,
    });
    result
}

/// When a client's TLS handshake with the engine began.
struct HandshakeAttempt {
    started_at: SystemTime,
    start: Instant,
}

/// How a client that hangs up on the engine's handshake is recorded as rejecting it.
const HANG_UP: &str = "hang_up";

/// Counts a failed handshake toward passing the address through, and, when this one starts
/// passing it through, records the failure as a flow of its own.
fn record_handshake_failure(
    engine: &Engine,
    target: &Target,
    conn: ClientConn,
    attempt: &HandshakeAttempt,
    certificate_alert: bool,
    rejection: Option<String>,
    e: &std::io::Error,
) {
    let addr = &target.addr;
    let failed = |id| ProxyEvent::HandshakeFailed {
        id,
        started_at: attempt.started_at,
        authority: target.authority.clone(),
        connection: conn.connection,
        client_addr: conn.addr,
        rejection,
        error: error_chain(e),
        elapsed_ms: attempt.start.elapsed().as_millis() as u64,
    };
    if engine.record_handshake_failure(addr, certificate_alert, failed) {
        info!("Client rejected the proxy for {addr}, passing it through: {e}");
    } else {
        debug!("TLS handshake with client failed for {addr}: {e}");
    }
}

/// The server closed the connection before or during the TLS handshake.
fn closed_by_server(e: &std::io::Error) -> bool {
    is_hang_up(e) || e.kind() == std::io::ErrorKind::BrokenPipe
}

/// The client closed the connection without a TLS `close_notify`, or reset it.
fn is_hang_up(e: &std::io::Error) -> bool {
    use std::io::ErrorKind::{ConnectionAborted, ConnectionReset, UnexpectedEof};
    matches!(e.kind(), UnexpectedEof | ConnectionReset | ConnectionAborted)
}

/// The alert a client sent rejecting the engine's certificate, by its name in the TLS spec, or
/// None when `e` is not such an alert.
fn certificate_rejection(e: &std::io::Error) -> Option<&'static str> {
    use rustls::AlertDescription::{
        BadCertificate, CertificateExpired, CertificateRevoked, CertificateUnknown, UnknownCA,
        UnsupportedCertificate,
    };
    let Some(rustls::Error::AlertReceived(alert)) =
        e.get_ref().and_then(|inner| inner.downcast_ref::<rustls::Error>())
    else {
        return None;
    };
    Some(match alert {
        BadCertificate => "bad_certificate",
        UnsupportedCertificate => "unsupported_certificate",
        CertificateRevoked => "certificate_revoked",
        CertificateExpired => "certificate_expired",
        CertificateUnknown => "certificate_unknown",
        UnknownCA => "unknown_ca",
        _ => return None,
    })
}

enum Upstream {
    H1(hyper::client::conn::http1::SendRequest<BoxBody>),
    H2(hyper::client::conn::http2::SendRequest<BoxBody>),
}

/// A connection to the server, and the address it reached.
struct UpstreamConn {
    sender: Upstream,
    remote_addr: Option<SocketAddr>,
    tls: TlsInfo,
}

/// When a connection to the server was made, and the TLS it negotiated.
#[derive(Debug, Clone)]
struct TlsInfo {
    /// When the TCP connection was made, or, for one opened as its CONNECT came in, when it was
    /// taken up for TLS.
    connected: Instant,
    /// How long opening it took, when it was opened as its CONNECT came in, before any request.
    dialled_before: Option<Duration>,
    handshaken: Instant,
    version: Option<String>,
    cipher: Option<String>,
}

impl TlsInfo {
    fn of(
        conn: &rustls::ClientConnection,
        connected: Instant,
        dialled_before: Option<Duration>,
    ) -> Self {
        let version = conn.protocol_version().map(|v| match v {
            rustls::ProtocolVersion::TLSv1_3 => "TLSv1.3".to_string(),
            rustls::ProtocolVersion::TLSv1_2 => "TLSv1.2".to_string(),
            other => format!("{other:?}"),
        });
        let cipher = conn.negotiated_cipher_suite().map(|s| format!("{:?}", s.suite()));
        Self { connected, dialled_before, handshaken: Instant::now(), version, cipher }
    }
}

impl UpstreamConn {
    /// Shared by another request, as an HTTP/2 connection is.
    fn share(&self, sender: Upstream) -> Self {
        Self { sender, remote_addr: self.remote_addr, tls: self.tls.clone() }
    }

    fn is_h2(&self) -> bool {
        matches!(self.sender, Upstream::H2(_))
    }

    fn is_closed(&self) -> bool {
        match &self.sender {
            Upstream::H1(s) => s.is_closed(),
            Upstream::H2(s) => s.is_closed(),
        }
    }

    /// Can take a request now: an HTTP/2 connection any time it is open, an HTTP/1.1 one once
    /// the response before has been read.
    fn is_ready(&self) -> bool {
        match &self.sender {
            Upstream::H1(s) => s.is_ready(),
            Upstream::H2(s) => s.is_ready(),
        }
    }

    async fn send(
        &mut self,
        req: Request<BoxBody>,
    ) -> Result<Response<Incoming>, TrySendError<Request<BoxBody>>> {
        match &mut self.sender {
            Upstream::H1(s) => s.try_send_request(req).await,
            Upstream::H2(s) => s.try_send_request(req).await,
        }
    }
}

/// Idle HTTP/1.1 connections kept per client connection, for its requests to come.
const MAX_IDLE_H1: usize = 6;

/// The connections to the server of one intercepted client connection, reused by its requests,
/// so an HTTP/2 client's streams do not each pay for a handshake. An HTTP/2 connection carries
/// them all at once; an HTTP/1.1 one a request at a time.
struct Upstreams {
    target: Target,
    /// The connection dialled before the CONNECT was answered, for the first one to the server.
    dialled: std::sync::Mutex<Option<Dialled>>,
    conns: tokio::sync::Mutex<Vec<UpstreamConn>>,
    /// The server answered in HTTP/1.1, so each request in flight needs a connection of its
    /// own, and new ones need not wait to see whether the one before can be shared.
    h1: AtomicBool,
}

impl Upstreams {
    fn new(target: Target, dialled: Option<Dialled>) -> Self {
        Self {
            target,
            dialled: std::sync::Mutex::new(dialled),
            conns: tokio::sync::Mutex::new(Vec::new()),
            h1: AtomicBool::new(false),
        }
    }

    /// A new connection to the server: over the one dialled before the CONNECT was answered,
    /// the first time, and dialled anew after.
    async fn connect(&self, engine: &Engine, h1_only: bool) -> Result<UpstreamConn, BoxError> {
        let dialled = self.dialled.lock().unwrap().take();
        connect_upstream(engine, &self.target, h1_only, dialled).await
    }

    /// A connection for one request, and whether it carried one before. Requests that arrive
    /// before the first connection is up wait for it, to share it if it is HTTP/2.
    async fn take(&self, engine: &Engine) -> Result<(UpstreamConn, bool), BoxError> {
        let mut conns = self.conns.lock().await;
        conns.retain(|c| !c.is_closed());
        if let Some(i) = conns.iter().position(UpstreamConn::is_ready) {
            let conn = match &conns[i].sender {
                Upstream::H2(s) => conns[i].share(Upstream::H2(s.clone())),
                Upstream::H1(_) => conns.swap_remove(i),
            };
            return Ok((conn, true));
        }
        if self.h1.load(Ordering::Relaxed) {
            drop(conns);
            return Ok((self.connect(engine, false).await?, false));
        }
        let conn = self.connect(engine, false).await?;
        match &conn.sender {
            Upstream::H2(s) => conns.push(conn.share(Upstream::H2(s.clone()))),
            Upstream::H1(_) => self.h1.store(true, Ordering::Relaxed),
        }
        Ok((conn, false))
    }

    /// Keeps a connection for later requests. An HTTP/1.1 one takes the next once this response
    /// has been read. An HTTP/2 one is kept already, unless it was opened to send a request again.
    async fn put_back(&self, conn: UpstreamConn) {
        if conn.is_closed() {
            return;
        }
        let mut conns = self.conns.lock().await;
        if conn.is_h2() {
            if !conns.iter().any(|c| c.is_h2() && !c.is_closed()) {
                conns.push(conn);
            }
        } else if conns.len() < MAX_IDLE_H1 {
            conns.push(conn);
        }
    }
}

/// Opens a connection to the server for requests: over `dialled` when there is one, and over a
/// new TCP connection otherwise, or when `dialled` was closed while it waited.
async fn connect_upstream(
    engine: &Engine,
    target: &Target,
    h1_only: bool,
    dialled: Option<Dialled>,
) -> Result<UpstreamConn, BoxError> {
    let config = if h1_only { &engine.upstream_tls_h1 } else { &engine.upstream_tls };
    let connector = TlsConnector::from(config.clone());
    let server_name = ServerName::try_from(target.server_name.clone())?;
    let mut tls = None;
    if let Some(Dialled { io, took }) = dialled {
        let (connected, remote_addr) = (Instant::now(), io.remote_addr());
        match connector.connect(server_name.clone(), io).await {
            Ok(stream) => tls = Some((stream, connected, Some(took), remote_addr)),
            // The server closed it while it waited for the first request.
            Err(e) if closed_by_server(&e) => {
                debug!("Connection to {} closed before its first request: {e}", target.addr);
            }
            Err(e) => return Err(e.into()),
        }
    }
    let (tls, connected, dialled_before, remote_addr) = match tls {
        Some(tls) => tls,
        None => {
            let tcp = TcpStream::connect(&target.addr).await?;
            let connected = Instant::now();
            let remote_addr = tcp.peer_addr().ok();
            let stream = connector.connect(server_name, UpstreamIo::Tcp(tcp)).await?;
            (stream, connected, None, remote_addr)
        }
    };
    let tls_info = TlsInfo::of(tls.get_ref().1, connected, dialled_before);
    let is_h2 = tls.get_ref().1.alpn_protocol() == Some(b"h2");
    let io = TokioIo::new(tls);

    let upstream = if is_h2 {
        let (sender, conn) =
            hyper::client::conn::http2::Builder::new(TokioExecutor::new()).handshake(io).await?;
        tokio::spawn(async move {
            if let Err(e) = conn.await {
                debug!("Upstream h2 connection error: {e}");
            }
        });
        Upstream::H2(sender)
    } else {
        let (sender, conn) = hyper::client::conn::http1::Builder::new()
            .preserve_header_case(true)
            .title_case_headers(true)
            .handshake(io)
            .await?;
        tokio::spawn(async move {
            if let Err(e) = conn.with_upgrades().await {
                debug!("Upstream h1 connection error: {e}");
            }
        });
        Upstream::H1(sender)
    };
    Ok(UpstreamConn { sender: upstream, remote_addr, tls: tls_info })
}

/// Addresses a request to the server in the protocol of `conn`. It may be addressed for the
/// other one already, when it is sent again on a new connection.
fn address(
    parts: &mut Parts,
    conn: &UpstreamConn,
    target: &Target,
    path: &str,
    has_body: bool,
) -> Result<(), String> {
    // The host the client asked for: `Host` over HTTP/1.1, `:authority` over HTTP/2, which
    // hyper keeps in the URI.
    let authority =
        parts.uri.authority().map_or_else(|| target.authority.clone(), |a| a.to_string());
    if conn.is_h2() {
        // `Host` moves into `:authority`. Google's servers reset any stream that has both, even
        // when they match.
        let host = match parts.headers.remove(HOST) {
            Some(host) => host.to_str().map_err(|e| e.to_string())?.to_string(),
            None => authority,
        };
        parts.uri = format!("https://{host}{path}").parse::<Uri>().map_err(|e| e.to_string())?;
    } else {
        parts.uri = path.parse::<Uri>().map_err(|e| e.to_string())?;
        if !parts.headers.contains_key(HOST)
            && let Ok(host) = authority.parse()
        {
            parts.headers.insert(HOST, host);
        }
        if parts.version == hyper::Version::HTTP_2 {
            parts.version = hyper::Version::HTTP_11;
            // HTTP/2 frames a body without a length. HTTP/1.1 needs one or chunks, and hyper
            // sends a GET with neither as empty. Chunks also carry trailers, those named in
            // `Trailer`: hyper's HTTP/1.1 encoder drops any others.
            if has_body && !parts.headers.contains_key(CONTENT_LENGTH) {
                parts.headers.insert(TRANSFER_ENCODING, HeaderValue::from_static("chunked"));
            }
            // HTTP/2 may split `Cookie` into a field per cookie; HTTP/1.1 has one (RFC 9113
            // 8.2.3).
            if parts.headers.get_all(COOKIE).iter().nth(1).is_some() {
                let joined = parts
                    .headers
                    .get_all(COOKIE)
                    .iter()
                    .map(HeaderValue::as_bytes)
                    .collect::<Vec<_>>()
                    .join(&b"; "[..]);
                let joined = HeaderValue::from_bytes(&joined).map_err(|e| e.to_string())?;
                parts.headers.insert(COOKIE, joined);
            }
        }
    }
    Ok(())
}

async fn forward_https(
    mut req: Request<Incoming>,
    upstreams: Arc<Upstreams>,
    client: ClientConn,
    engine: Arc<Engine>,
) -> Result<Response<BoxBody>, Infallible> {
    let target = &upstreams.target;
    let path = req.uri().path_and_query().map(|pq| pq.to_string()).unwrap_or_else(|| "/".into());
    let url = format!("https://{}{path}", target.authority);
    let mut flow = Flow::begin(engine.clone(), client, &req, url);

    // Only HTTP/1.1 has `Upgrade`. Its connection is the tunnel afterwards, so it is not shared.
    let client_upgrade: Option<OnUpgrade> =
        req.headers().contains_key(UPGRADE).then(|| hyper::upgrade::on(&mut req));
    let taken = match client_upgrade {
        Some(_) => upstreams.connect(&engine, true).await.map(|c| (c, false)),
        None => upstreams.take(&engine).await,
    };
    let (mut conn, mut reused) = match taken {
        Ok(taken) => taken,
        Err(e) => return Ok(flow.fail(error_chain(e.as_ref()))),
    };
    flow.goes_on(&conn, reused);

    let (mut parts, body) = req.into_parts();
    if let Err(e) = address(&mut parts, &conn, target, &path, !body.is_end_stream()) {
        return Ok(flow.fail(e));
    }
    let mut outgoing = Request::from_parts(parts, flow.capture_request(body));

    let mut resp = loop {
        let mut e = match conn.send(outgoing).await {
            Ok(resp) => break resp,
            Err(e) => e,
        };
        // A reused connection the server closed as the request went out: the request never
        // left, so it goes again, once, on a new connection.
        let Some(unsent) = e.take_message().filter(|_| reused) else {
            return Ok(flow.fail(error_chain(e.error())));
        };
        debug!("Upstream connection to {} was closed, retrying on a new one", target.addr);
        conn = match upstreams.connect(&engine, false).await {
            Ok(conn) => conn,
            Err(e) => return Ok(flow.fail(error_chain(e.as_ref()))),
        };
        reused = false;
        flow.goes_on(&conn, reused);
        let (mut parts, body) = unsent.into_parts();
        if let Err(e) = address(&mut parts, &conn, target, &path, !body.is_end_stream()) {
            return Ok(flow.fail(e));
        }
        outgoing = Request::from_parts(parts, body);
    };
    let remote_addr = conn.remote_addr;
    if client_upgrade.is_none() {
        upstreams.put_back(conn).await;
    }

    if resp.status() == StatusCode::SWITCHING_PROTOCOLS
        && let Some(client_upgrade) = client_upgrade
    {
        let upstream_upgrade = hyper::upgrade::on(&mut resp);
        let addr = target.addr.clone();
        let websocket = header_str(resp.headers(), UPGRADE.as_str())
            .is_some_and(|u| u.trim().eq_ignore_ascii_case("websocket"));
        if websocket && engine.websocket_capture {
            let deflate = ws::negotiated_deflate(resp.headers());
            let (resp, ws_flow) = flow.respond_websocket(resp, remote_addr);
            tokio::spawn(async move {
                if let Err(e) = ws::relay(client_upgrade, upstream_upgrade, ws_flow, deflate).await
                {
                    debug!("WebSocket to {addr} ended: {e}");
                }
            });
            return Ok(resp);
        }
        tokio::spawn(async move {
            if let Err(e) = splice(client_upgrade, upstream_upgrade).await {
                debug!("Upgraded tunnel to {addr} ended: {e}");
            }
        });
    }

    Ok(flow.respond(resp, remote_addr))
}
