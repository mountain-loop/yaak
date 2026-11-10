use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::Receiver;
use std::time::{Duration, SystemTime};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::client::conn::http2;
use hyper::header::{CONNECTION, CONTENT_LENGTH, CONTENT_TYPE, HOST, HeaderValue, UPGRADE};
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode, Version};
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto;
use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName};
use rustls::{ClientConfig, RootCertStore, ServerConfig};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::{TlsAcceptor, TlsConnector};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
use tokio_tungstenite::tungstenite::protocol::Role;
use tokio_tungstenite::tungstenite::protocol::frame::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use yaak_proxy::{
    BUILT_IN_EXCLUSIONS, CaStore, DecryptApp, DecryptPolicy, MessageDirection, MessageKind,
    ProxyConfig, ProxyEvent, ProxyHandle, StreamKind, StreamMessage, TunnelReason, start_proxy,
};

const BIG_BODY: usize = 64 * 1024;

/// The longest a streaming test may run: one that hangs fails with a message instead of
/// holding CI until its job is cancelled.
const STREAM_TEST_TIMEOUT: Duration = Duration::from_secs(60);

async fn within<T>(test: impl Future<Output = T>) -> T {
    match tokio::time::timeout(STREAM_TEST_TIMEOUT, test).await {
        Ok(result) => result,
        Err(_) => panic!("the test did not finish within {STREAM_TEST_TIMEOUT:?}"),
    }
}

macro_rules! find {
    ($events:expr, $pat:pat => $out:expr) => {
        $events
            .iter()
            .find_map(|e| match e {
                $pat => Some($out),
                _ => None,
            })
            .unwrap_or_else(|| panic!("no {} in {:#?}", stringify!($pat), $events))
    };
}

fn ring() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

/// A throwaway CA and a `localhost` certificate it signed, standing in for a real server.
struct TestPki {
    ca_pem: String,
    ca_der: CertificateDer<'static>,
    server: Arc<ServerConfig>,
}

fn test_pki() -> TestPki {
    let ca_key = KeyPair::generate().unwrap();
    let mut ca_params = CertificateParams::default();
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca_params.distinguished_name.push(rcgen::DnType::CommonName, "Upstream Test CA");
    let ca = ca_params.self_signed(&ca_key).unwrap();

    let leaf_key = KeyPair::generate().unwrap();
    let leaf_params = CertificateParams::new(vec!["localhost".into()]).unwrap();
    let leaf = leaf_params.signed_by(&leaf_key, &ca, &ca_key).unwrap();

    let mut server = ServerConfig::builder_with_provider(ring())
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![leaf.der().clone()],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(leaf_key.serialize_der())),
        )
        .unwrap();
    server.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

    TestPki { ca_pem: ca.pem(), ca_der: ca.der().clone(), server: Arc::new(server) }
}

type TestBody = BoxBody<Bytes, Infallible>;

fn full(data: impl Into<Bytes>) -> TestBody {
    Full::new(data.into()).boxed()
}

async fn route(req: Request<Incoming>) -> Result<Response<TestBody>, Infallible> {
    Ok(match req.uri().path() {
        "/hello" => Response::new(full("hello")),
        // An upload cut short, as a cancelled one is, gets an empty answer.
        "/echo" => match req.into_body().collect().await {
            Ok(body) => Response::new(full(body.to_bytes())),
            Err(_) => Response::builder().status(StatusCode::BAD_REQUEST).body(full("")).unwrap(),
        },
        "/authority" => Response::new(full(format!(
            "authority={} host={}",
            req.uri().authority().map_or("none".into(), |a| a.to_string()),
            req.headers().get(HOST).map_or("none", |h| h.to_str().unwrap()),
        ))),
        "/big" => Response::new(full(vec![b'x'; BIG_BODY])),
        // No body: `Content-Length: 0`, or a stream with nothing in it, chunked on HTTP/1.1.
        "/empty" => Response::new(full("")),
        "/empty-stream" => {
            Response::new(BodyExt::boxed(StreamBody::new(futures_util::stream::empty())))
        }
        "/late-end" => late_end(5),
        // The stream ends with half the promised bytes, so the upstream resets it mid-body.
        "/cut" => late_end(10),
        "/ws" => websocket_echo(req),
        "/trailers" => echo_with_trailers(req).await,
        "/cookies" => {
            let cookies = req.headers().get_all("cookie").iter();
            Response::new(full(
                cookies.map(|c| c.to_str().unwrap()).collect::<Vec<_>>().join(" | "),
            ))
        }
        // Headers for this connection alone, which HTTP/2 forbids.
        "/hop" => Response::builder()
            .header(CONNECTION, "x-hop")
            .header("x-hop", "1")
            .header("keep-alive", "timeout=5")
            .body(full("hop"))
            .unwrap(),
        _ => Response::builder().status(StatusCode::NOT_FOUND).body(full("not found")).unwrap(),
    })
}

/// The request body back, with the request's trailers and one of the server's own.
async fn echo_with_trailers(req: Request<Incoming>) -> Response<TestBody> {
    let collected = req.into_body().collect().await.unwrap();
    let mut trailers = collected.trailers().cloned().unwrap_or_default();
    trailers.insert("x-upstream-trailer", HeaderValue::from_static("yes"));
    let frames = [
        Ok(Frame::data(collected.to_bytes())),
        Ok(Frame::trailers(trailers)),
    ];
    Response::builder()
        // HTTP/1.1 sends only the trailers it names.
        .header("trailer", "x-client-trailer, x-upstream-trailer")
        .body(BodyExt::boxed(StreamBody::new(futures_util::stream::iter(frames))))
        .unwrap()
}

/// "hello" under a Content-Length of `content_length`, its end of stream sent a while after the
/// last byte, as an HTTP/2 server does when its final DATA frame has no END_STREAM.
fn late_end(content_length: usize) -> Response<TestBody> {
    let frames = futures_util::stream::unfold(false, |sent| async move {
        if sent {
            tokio::time::sleep(Duration::from_millis(300)).await;
            return None;
        }
        Some((Ok(Frame::data(Bytes::from("hello"))), true))
    });
    Response::builder()
        .header(CONTENT_LENGTH, content_length)
        .body(BodyExt::boxed(StreamBody::new(frames)))
        .unwrap()
}

fn websocket_echo(mut req: Request<Incoming>) -> Response<TestBody> {
    let accept = derive_accept_key(req.headers()["sec-websocket-key"].as_bytes());
    let on_upgrade = hyper::upgrade::on(&mut req);
    tokio::spawn(async move {
        let io = TokioIo::new(on_upgrade.await.unwrap());
        let mut ws = WebSocketStream::from_raw_socket(io, Role::Server, None).await;
        while let Some(Ok(msg)) = ws.next().await {
            if msg.is_text() || msg.is_binary() {
                ws.send(msg).await.unwrap();
            }
        }
    });
    Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header(UPGRADE, "websocket")
        .header(CONNECTION, "Upgrade")
        .header("sec-websocket-accept", accept)
        .body(full(Bytes::new()))
        .unwrap()
}

async fn spawn_upstream(tls: Option<Arc<ServerConfig>>) -> SocketAddr {
    spawn_upstream_with(tls, Arc::new(AtomicUsize::new(0)), route).await
}

/// An upstream server answering with `handler`, counting the connections it accepts in
/// `accepts`.
async fn spawn_upstream_with<F, Fut>(
    tls: Option<Arc<ServerConfig>>,
    accepts: Arc<AtomicUsize>,
    handler: F,
) -> SocketAddr
where
    F: Fn(Request<Incoming>) -> Fut + Clone + Send + Sync + 'static,
    Fut: Future<Output = Result<Response<TestBody>, Infallible>> + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            accepts.fetch_add(1, Ordering::SeqCst);
            let tls = tls.clone();
            let handler = handler.clone();
            tokio::spawn(async move {
                let builder = auto::Builder::new(TokioExecutor::new());
                let svc = service_fn(handler);
                let _ = match tls {
                    Some(config) => {
                        let Ok(stream) = TlsAcceptor::from(config).accept(tcp).await else {
                            return;
                        };
                        builder.serve_connection_with_upgrades(TokioIo::new(stream), svc).await
                    }
                    None => builder.serve_connection_with_upgrades(TokioIo::new(tcp), svc).await,
                };
            });
        }
    });
    addr
}

struct Harness {
    proxy: ProxyHandle,
    events: Receiver<ProxyEvent>,
    ca: Arc<CaStore>,
    pki: TestPki,
    _dir: TempDir,
}

impl Harness {
    fn start(capture_body_limit: usize) -> Self {
        Self::start_with(capture_body_limit, |_| {})
    }

    fn start_with(capture_body_limit: usize, configure: impl FnOnce(&mut ProxyConfig)) -> Self {
        let dir = TempDir::new().unwrap();
        let ca_dir = dir.path().join("ca");
        let created = CaStore::load_or_create(&ca_dir).unwrap();
        // Run against a reloaded CA so leaf certificates must chain to the saved ca.pem.
        let ca = Arc::new(CaStore::load_or_create(&ca_dir).unwrap());
        assert_eq!(created.pem(), ca.pem());

        let pki = test_pki();
        let mut config = ProxyConfig::new(0, ca.clone());
        config.capture_body_limit = capture_body_limit;
        config.upstream_root_certs = vec![pki.ca_der.clone()];
        configure(&mut config);
        let mut proxy = start_proxy(config).unwrap();
        let events = proxy.take_event_rx().unwrap();
        Self { proxy, events, ca, pki, _dir: dir }
    }

    fn proxy_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.proxy.port)
    }

    /// An HTTP/1.1 client. The HTTP/2 tests below make their own.
    fn client_trusting(&self, root_pem: &str) -> reqwest::Client {
        reqwest::Client::builder()
            .http1_only()
            .proxy(reqwest::Proxy::all(self.proxy_url()).unwrap())
            .add_root_certificate(reqwest::Certificate::from_pem(root_pem.as_bytes()).unwrap())
            .build()
            .unwrap()
    }

    fn client(&self) -> reqwest::Client {
        self.client_trusting(self.ca.pem())
    }

    /// Sends `req` to the proxy exactly as built, bare path and all, as a client that doesn't know
    /// it is talking to a proxy would.
    async fn send_as_written(&self, req: Request<TestBody>) -> Response<Incoming> {
        let tcp = TcpStream::connect(("127.0.0.1", self.proxy.port)).await.unwrap();
        let (mut sender, conn) =
            hyper::client::conn::http1::handshake(TokioIo::new(tcp)).await.unwrap();
        tokio::spawn(conn);
        sender.send_request(req).await.unwrap()
    }

    /// A raw connection tunneled through the proxy with CONNECT to `localhost:port`.
    async fn connect_tunnel(&self, port: u16) -> TcpStream {
        let mut tcp = TcpStream::connect(("127.0.0.1", self.proxy.port)).await.unwrap();
        let connect =
            format!("CONNECT localhost:{port} HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n");
        tcp.write_all(connect.as_bytes()).await.unwrap();
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            head.push(tcp.read_u8().await.unwrap());
        }
        assert!(head.starts_with(b"HTTP/1.1 200"), "{}", String::from_utf8_lossy(&head));
        tcp
    }

    fn tls_client_config(&self) -> Arc<ClientConfig> {
        let mut roots = RootCertStore::empty();
        roots
            .add(CertificateDer::from(pem::parse(self.ca.pem()).unwrap().into_contents()))
            .unwrap();
        let config = ClientConfig::builder_with_provider(ring())
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(roots)
            .with_no_client_auth();
        Arc::new(config)
    }

    /// Waits until the engine reports `state` (failures counted, passed through) for `addr`.
    async fn wait_for_handshake_state(&self, addr: &str, state: (u32, bool)) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while self.proxy.handshake_state(addr) != state {
            assert!(
                tokio::time::Instant::now() < deadline,
                "{addr} stayed at {:?}, expected {state:?}",
                self.proxy.handshake_state(addr)
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    /// Events of the next flow, through its terminal event plus any stragglers.
    fn flow_events(&self) -> Vec<ProxyEvent> {
        let mut events = Vec::new();
        loop {
            let event =
                self.events.recv_timeout(Duration::from_secs(10)).expect("flow did not end");
            let done = is_terminal(&event);
            events.push(event);
            if done {
                break;
            }
        }
        while let Ok(event) = self.events.recv_timeout(Duration::from_millis(100)) {
            events.push(event);
        }
        events
    }

    /// Events of the next `n` flows, which may interleave, by flow id.
    fn flows_events(&self, n: usize) -> HashMap<u64, Vec<ProxyEvent>> {
        let mut flows: HashMap<u64, Vec<ProxyEvent>> = HashMap::new();
        let mut ended = 0;
        while ended < n {
            let event =
                self.events.recv_timeout(Duration::from_secs(10)).expect("flows did not end");
            ended += usize::from(is_terminal(&event));
            flows.entry(flow_id(&event)).or_default().push(event);
        }
        while let Ok(event) = self.events.recv_timeout(Duration::from_millis(100)) {
            flows.entry(flow_id(&event)).or_default().push(event);
        }
        flows
    }

    /// TLS to `localhost:port` through a CONNECT tunnel, trusting the proxy's CA and offering
    /// `alpn`.
    async fn tls_tunnel(
        &self,
        port: u16,
        alpn: &[&[u8]],
    ) -> tokio_rustls::client::TlsStream<TcpStream> {
        let mut config = ClientConfig::clone(&self.tls_client_config());
        config.alpn_protocols = alpn.iter().map(|p| p.to_vec()).collect();
        let tcp = self.connect_tunnel(port).await;
        let server_name = ServerName::try_from("localhost").unwrap();
        TlsConnector::from(Arc::new(config)).connect(server_name, tcp).await.unwrap()
    }

    /// An HTTP/2 connection to `localhost:port` through the proxy, offering both versions as a
    /// browser does.
    async fn h2_client(&self, port: u16) -> http2::SendRequest<TestBody> {
        let tls = self.tls_tunnel(port, &[b"h2", b"http/1.1"]).await;
        assert_eq!(tls.get_ref().1.alpn_protocol(), Some(&b"h2"[..]));
        let (sender, conn) =
            http2::handshake(TokioExecutor::new(), TokioIo::new(tls)).await.unwrap();
        tokio::spawn(conn);
        sender
    }
}

fn is_terminal(event: &ProxyEvent) -> bool {
    matches!(
        event,
        ProxyEvent::ResponseBodyComplete { .. }
            | ProxyEvent::Error { .. }
            | ProxyEvent::Cancelled { .. }
            | ProxyEvent::StreamEnd { .. }
            | ProxyEvent::TunnelEnd { .. }
            | ProxyEvent::HandshakeFailed { .. }
    )
}

fn flow_id(event: &ProxyEvent) -> u64 {
    match event {
        ProxyEvent::RequestStart { id, .. }
        | ProxyEvent::RequestHeader { id, .. }
        | ProxyEvent::RequestBodyChunk { id, .. }
        | ProxyEvent::RequestBodyComplete { id, .. }
        | ProxyEvent::UpstreamConnection { id, .. }
        | ProxyEvent::ResponseStart { id, .. }
        | ProxyEvent::ResponseHeader { id, .. }
        | ProxyEvent::ResponseBodyChunk { id, .. }
        | ProxyEvent::ResponseBodyComplete { id, .. }
        | ProxyEvent::Error { id, .. }
        | ProxyEvent::Cancelled { id, .. }
        | ProxyEvent::StreamStart { id, .. }
        | ProxyEvent::Message { id, .. }
        | ProxyEvent::StreamEnd { id, .. }
        | ProxyEvent::TunnelStart { id, .. }
        | ProxyEvent::TunnelEnd { id, .. }
        | ProxyEvent::HandshakeFailed { id, .. } => *id,
    }
}

/// The headers a flow captured on one side, in order.
fn headers(events: &[ProxyEvent], request: bool) -> Vec<(String, String)> {
    events
        .iter()
        .filter_map(|e| match e {
            ProxyEvent::RequestHeader { name, value, .. } if request => {
                Some((name.clone(), value.clone()))
            }
            ProxyEvent::ResponseHeader { name, value, .. } if !request => {
                Some((name.clone(), value.clone()))
            }
            _ => None,
        })
        .collect()
}

/// The captured bytes of one side of a flow, and how many bytes passed through.
fn body(events: &[ProxyEvent], request: bool) -> (Vec<u8>, usize) {
    let mut captured = Vec::new();
    let mut passed = 0;
    for event in events {
        match event {
            ProxyEvent::RequestBodyChunk { len, data, .. } if request => {
                captured.extend_from_slice(data);
                passed += len;
            }
            ProxyEvent::ResponseBodyChunk { len, data, .. } if !request => {
                captured.extend_from_slice(data);
                passed += len;
            }
            _ => {}
        }
    }
    (captured, passed)
}

#[test]
fn ca_is_persisted_with_private_key() {
    let dir = TempDir::new().unwrap();
    let first = CaStore::load_or_create(dir.path()).unwrap();
    let second = CaStore::load_or_create(dir.path()).unwrap();

    assert_eq!(first.pem(), second.pem());
    assert_eq!(std::fs::read_to_string(first.cert_path()).unwrap(), first.pem());
    let der = pem::parse(first.pem()).unwrap().into_contents();
    assert!(der.windows(13).any(|w| w == b"Yaak Proxy CA"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(first.key_path()).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn concurrent_creators_agree_on_one_ca() {
    for _ in 0..20 {
        let dir = TempDir::new().unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(8));
        let pems: Vec<String> = (0..8)
            .map(|_| {
                let (dir, barrier) = (dir.path().to_path_buf(), barrier.clone());
                std::thread::spawn(move || {
                    barrier.wait();
                    CaStore::load_or_create(&dir).unwrap().pem().to_string()
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|t| t.join().unwrap())
            .collect();

        let on_disk = std::fs::read_to_string(dir.path().join("ca.pem")).unwrap();
        assert!(pems.iter().all(|p| *p == on_disk), "creators returned different CAs");
        let key = KeyPair::from_pem(&std::fs::read_to_string(dir.path().join("ca.key")).unwrap())
            .unwrap();
        let cert = pem::parse(&on_disk).unwrap().into_contents();
        let spki = key.public_key_der();
        assert!(cert.windows(spki.len()).any(|w| w == spki), "ca.key does not match ca.pem");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn https_get() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let url = format!("https://localhost:{}/hello", upstream.port());

    let resp = h.client().get(&url).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.unwrap(), "hello");

    let events = h.flow_events();
    let (method, req_url, req_version, started_at, connection, client_addr) = find!(events,
        ProxyEvent::RequestStart { method, url, http_version, started_at, connection, client_addr, .. } =>
            (method.clone(), url.clone(), http_version.clone(), *started_at, *connection, *client_addr));
    assert_eq!(method, "GET");
    assert_eq!(req_url, url);
    assert_eq!(req_version, "HTTP/1.1");
    // The request inside the tunnel keeps the connection the CONNECT came on.
    assert_eq!(connection, 1);
    assert!(client_addr.ip().is_loopback() && client_addr.port() != h.proxy.port, "{client_addr}");
    assert!(SystemTime::now().duration_since(started_at).unwrap() < Duration::from_secs(30));

    let (status, res_version, remote_addr, headers_ms) = find!(events,
        ProxyEvent::ResponseStart { status, http_version, remote_addr, elapsed_ms, .. } =>
            (*status, http_version.clone(), *remote_addr, *elapsed_ms));
    assert_eq!(status, 200);
    assert_eq!(res_version, "HTTP/2");
    assert_eq!(remote_addr, Some(upstream));

    let (size, truncated, end_ms, error) = find!(events,
        ProxyEvent::ResponseBodyComplete { size, truncated, elapsed_ms, error, .. } =>
            (*size, *truncated, *elapsed_ms, error.clone()));
    assert_eq!(body(&events, false), (b"hello".to_vec(), 5));
    assert_eq!((size, truncated, error), (5, false, None));
    assert!(end_ms >= headers_ms);
    assert_eq!(body(&events, true), (Vec::new(), 0));
    assert!(!events.iter().any(|e| matches!(e, ProxyEvent::RequestBodyComplete { .. })));
}

#[tokio::test(flavor = "multi_thread")]
async fn https_post_with_body() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let url = format!("https://localhost:{}/echo", upstream.port());

    let resp = h.client().post(&url).body("name=yaak").send().await.unwrap();
    assert_eq!(resp.text().await.unwrap(), "name=yaak");

    let events = h.flow_events();
    let method = find!(events, ProxyEvent::RequestStart { method, .. } => method.clone());
    assert_eq!(method, "POST");
    let (size, truncated) = find!(events,
        ProxyEvent::RequestBodyComplete { size, truncated, .. } => (*size, *truncated));
    assert_eq!((size, truncated), (9, false));
    assert_eq!(body(&events, true), (b"name=yaak".to_vec(), 9));
    assert_eq!(body(&events, false), (b"name=yaak".to_vec(), 9));
}

/// Chrome's request headers for `optimizationguide-pa.googleapis.com`, plus the other headers
/// HTTP/2 forbids. Google resets an HTTP/2 stream that has `Host` alongside `:authority`, and
/// hyper's HTTP/2 server resets one with any of the rest.
#[tokio::test(flavor = "multi_thread")]
async fn https_h2_upstream_gets_authority_without_host() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let url = format!("https://localhost:{}/authority", upstream.port());

    let resp = h
        .client()
        .post(&url)
        .header("connection", "keep-alive, x-hop")
        .header("x-hop", "1")
        .header("keep-alive", "timeout=5")
        .header("proxy-connection", "keep-alive")
        .header("te", "gzip")
        .header("content-type", "application/x-protobuf")
        .header("sec-fetch-site", "none")
        .header("sec-fetch-mode", "no-cors")
        .header("sec-fetch-dest", "empty")
        .header(
            "user-agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like \
             Gecko) Chrome/156.0.0.0 Safari/537.36",
        )
        .header("accept-encoding", "gzip, deflate, br, zstd")
        .body(vec![0u8; 1034])
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let expected = format!("authority=localhost:{} host=none", upstream.port());
    assert_eq!(resp.text().await.unwrap(), expected);

    let events = h.flow_events();
    let version = find!(events, ProxyEvent::ResponseStart { http_version, .. } => http_version);
    assert_eq!(version, "HTTP/2");
    let captured_host = events.iter().any(|e| {
        matches!(e, ProxyEvent::RequestHeader { name, value, .. }
            if name == "host" && *value == format!("localhost:{}", upstream.port()))
    });
    assert!(captured_host, "the captured request keeps Host");
}

/// A `Host` other than the CONNECT target still names the virtual host upstream.
#[tokio::test(flavor = "multi_thread")]
async fn https_h2_upstream_gets_the_clients_host_as_authority() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let url = format!("https://localhost:{}/authority", upstream.port());

    let resp = h.client().get(&url).header("host", "yaak.test:8443").send().await.unwrap();
    assert_eq!(resp.text().await.unwrap(), "authority=yaak.test:8443 host=none");
}

#[tokio::test(flavor = "multi_thread")]
async fn https_not_found() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let url = format!("https://localhost:{}/missing", upstream.port());

    let resp = h.client().get(&url).send().await.unwrap();
    assert_eq!(resp.status(), 404);
    assert_eq!(resp.text().await.unwrap(), "not found");

    let events = h.flow_events();
    assert_eq!(find!(events, ProxyEvent::ResponseStart { status, .. } => *status), 404);
    let error = find!(events, ProxyEvent::ResponseBodyComplete { error, .. } => error.clone());
    assert_eq!(error, None);
    assert_eq!(body(&events, false), (b"not found".to_vec(), 9));
}

/// The client is sent every byte the Content-Length promised, and hyper drops the body there,
/// before an HTTP/2 upstream's end of stream arrives. That is a complete response, not an error.
#[tokio::test(flavor = "multi_thread")]
async fn https_body_complete_before_end_of_stream() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let url = format!("https://localhost:{}/late-end", upstream.port());

    let resp = h.client().get(&url).send().await.unwrap();
    assert_eq!(resp.text().await.unwrap(), "hello");

    let events = h.flow_events();
    let version =
        find!(events, ProxyEvent::ResponseStart { http_version, .. } => http_version.clone());
    assert_eq!(version, "HTTP/2");
    let (size, error) = find!(events,
        ProxyEvent::ResponseBodyComplete { size, error, .. } => (*size, error.clone()));
    assert_eq!((size, error), (5, None));
    assert_eq!(body(&events, false), (b"hello".to_vec(), 5));
}

#[tokio::test(flavor = "multi_thread")]
async fn https_body_cut_short_is_an_error() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let url = format!("https://localhost:{}/cut", upstream.port());

    let resp = h.client().get(&url).send().await.unwrap();
    assert!(resp.bytes().await.is_err());

    let events = h.flow_events();
    let error = find!(events, ProxyEvent::ResponseBodyComplete { error, .. } => error.clone());
    assert!(error.is_some(), "{events:#?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn bodies_over_the_cap_are_truncated_but_delivered() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let client = h.client();

    let url = format!("https://localhost:{}/big", upstream.port());
    let received = client.get(&url).send().await.unwrap().bytes().await.unwrap();
    assert_eq!(received.len(), BIG_BODY);

    let events = h.flow_events();
    let (size, truncated) = find!(events,
        ProxyEvent::ResponseBodyComplete { size, truncated, .. } => (*size, *truncated));
    assert_eq!((size, truncated), (BIG_BODY as u64, true));
    assert_eq!(body(&events, false), (vec![b'x'; 1024], BIG_BODY));

    let url = format!("https://localhost:{}/echo", upstream.port());
    let sent = vec![b'y'; 4096];
    let echoed = client.post(&url).body(sent.clone()).send().await.unwrap().bytes().await.unwrap();
    assert_eq!(echoed.as_ref(), sent.as_slice());

    let events = h.flow_events();
    let (size, truncated) = find!(events,
        ProxyEvent::RequestBodyComplete { size, truncated, .. } => (*size, *truncated));
    assert_eq!((size, truncated), (4096, true));
    assert_eq!(body(&events, true), (vec![b'y'; 1024], 4096));
}

#[tokio::test(flavor = "multi_thread")]
async fn websocket_upgrade_passes_through() {
    within(async {
        let h = Harness::start(1024);
        let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
        let port = upstream.port();

        let tcp = h.connect_tunnel(port).await;
        let tls = TlsConnector::from(h.tls_client_config())
            .connect(ServerName::try_from("localhost").unwrap(), tcp)
            .await
            .unwrap();

        let url = format!("wss://localhost:{port}/ws");
        let (mut ws, _) = tokio_tungstenite::client_async(url.as_str(), tls).await.unwrap();
        ws.send(Message::text("hello")).await.unwrap();
        assert_eq!(ws.next().await.unwrap().unwrap().into_text().unwrap().as_str(), "hello");
        ws.send(Message::binary(vec![0u8, 1, 2, 255])).await.unwrap();
        assert_eq!(ws.next().await.unwrap().unwrap().into_data().as_ref(), &[0u8, 1, 2, 255]);
        ws.send(Message::Ping(Bytes::from_static(b"p"))).await.unwrap();
        assert!(
            matches!(ws.next().await.unwrap().unwrap(), Message::Pong(p) if p.as_ref() == b"p")
        );
        ws.close(Some(CloseFrame { code: CloseCode::Normal, reason: "bye".into() })).await.unwrap();
        while let Some(Ok(_)) = ws.next().await {}

        let events = h.flow_events();
        let req_url = find!(events, ProxyEvent::RequestStart { url, .. } => url.clone());
        assert_eq!(req_url, format!("https://localhost:{port}/ws"));
        let (status, version) = find!(events,
        ProxyEvent::ResponseStart { status, http_version, .. } => (*status, http_version.clone()));
        assert_eq!((status, version.as_str()), (101, "HTTP/1.1"));
        let kind = find!(events, ProxyEvent::StreamStart { kind, .. } => *kind);
        assert_eq!(kind, StreamKind::WebSocket);
        // The flow ends with the close handshake, not with the 101.
        assert!(!events.iter().any(|e| matches!(e, ProxyEvent::ResponseBodyComplete { .. })));
        let error = find!(events, ProxyEvent::StreamEnd { error, .. } => error.clone());
        assert_eq!(error, None);

        for direction in [MessageDirection::Client, MessageDirection::Server] {
            let sent = messages(&events, direction);
            let expected_control = match direction {
                MessageDirection::Client => MessageKind::WebSocketPing,
                MessageDirection::Server => MessageKind::WebSocketPong,
            };
            let close = MessageKind::WebSocketClose { code: Some(1000), reason: "bye".into() };
            let kinds: Vec<_> = sent.iter().map(|m| m.kind.clone()).collect();
            assert_eq!(
                kinds,
                vec![
                    MessageKind::WebSocketText,
                    MessageKind::WebSocketBinary,
                    expected_control,
                    close
                ],
                "{direction:?}"
            );
            assert_eq!(&sent[0].data[..], b"hello");
            assert_eq!(&sent[1].data[..], &[0u8, 1, 2, 255]);
            assert_eq!(&sent[2].data[..], b"p");
        }
    })
    .await
}

/// The messages a flow recorded from one side, in order.
fn messages(events: &[ProxyEvent], direction: MessageDirection) -> Vec<StreamMessage> {
    events
        .iter()
        .filter_map(|e| match e {
            ProxyEvent::Message { message, .. } if message.direction == direction => {
                Some(message.clone())
            }
            _ => None,
        })
        .collect()
}

/// A WebSocket frame as written on the wire, masked when `mask` is given.
fn ws_frame(fin: bool, rsv1: bool, opcode: u8, payload: &[u8], mask: Option<[u8; 4]>) -> Vec<u8> {
    let mut out = vec![(u8::from(fin) << 7) | (u8::from(rsv1) << 6) | opcode];
    let mask_bit = if mask.is_some() { 0x80 } else { 0 };
    match payload.len() {
        n if n < 126 => out.push(mask_bit | n as u8),
        n if n <= u16::MAX as usize => {
            out.push(mask_bit | 126);
            out.extend((n as u16).to_be_bytes());
        }
        n => {
            out.push(mask_bit | 127);
            out.extend((n as u64).to_be_bytes());
        }
    }
    match mask {
        Some(mask) => {
            out.extend(mask);
            out.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
        }
        None => out.extend(payload),
    }
    out
}

/// permessage-deflate's compression of one message, in a context kept across messages.
fn deflate_message(compress: &mut flate2::Compress, data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 64);
    compress.compress_vec(data, &mut out, flate2::FlushCompress::Sync).unwrap();
    assert!(out.ends_with(&[0, 0, 0xff, 0xff]));
    out.truncate(out.len() - 4);
    out
}

/// A server that switches to WebSocket with permessage-deflate and then sends back every byte
/// it gets, as it got it, keeping a copy.
fn raw_websocket_echo(
    mut req: Request<Incoming>,
    received: Arc<std::sync::Mutex<Vec<u8>>>,
) -> Response<TestBody> {
    let accept = derive_accept_key(req.headers()["sec-websocket-key"].as_bytes());
    let on_upgrade = hyper::upgrade::on(&mut req);
    tokio::spawn(async move {
        let mut io = TokioIo::new(on_upgrade.await.unwrap());
        let mut buf = vec![0u8; 4096];
        loop {
            let n = io.read(&mut buf).await.unwrap_or(0);
            if n == 0 {
                break;
            }
            received.lock().unwrap().extend_from_slice(&buf[..n]);
            io.write_all(&buf[..n]).await.unwrap();
        }
    });
    Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header(UPGRADE, "websocket")
        .header(CONNECTION, "Upgrade")
        .header("sec-websocket-accept", accept)
        .header("sec-websocket-extensions", "permessage-deflate")
        .body(full(Bytes::new()))
        .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn websocket_frames_pass_byte_for_byte() {
    within(async {
    let h = Harness::start(1024 * 1024);
    let received = Arc::new(std::sync::Mutex::new(Vec::new()));
    let handler = {
        let received = received.clone();
        move |req| {
            let received = received.clone();
            async move { Ok::<_, Infallible>(raw_websocket_echo(req, received)) }
        }
    };
    let upstream =
        spawn_upstream_with(Some(h.pki.server.clone()), Arc::new(AtomicUsize::new(0)), handler)
            .await;
    let mut tls = h.tls_tunnel(upstream.port(), &[b"http/1.1"]).await;
    let handshake = format!(
        "GET /raw HTTP/1.1\r\nHost: localhost:{}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\
        Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\
        Sec-WebSocket-Extensions: permessage-deflate\r\n\r\n",
        upstream.port()
    );
    tls.write_all(handshake.as_bytes()).await.unwrap();
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        head.push(tls.read_u8().await.unwrap());
    }
    assert!(head.starts_with(b"HTTP/1.1 101"), "{}", String::from_utf8_lossy(&head));

    let mask = Some([0x12, 0x34, 0x56, 0x78]);
    let mut compress = flate2::Compress::new(flate2::Compression::default(), false);
    let big: Vec<u8> = (0..200_000u32).map(|i| (i % 7) as u8).collect();
    let mut wire = Vec::new();
    // A text message in two fragments, with a ping between them.
    wire.extend(ws_frame(false, false, 0x1, b"Hel", mask));
    wire.extend(ws_frame(true, false, 0x9, b"x", mask));
    wire.extend(ws_frame(true, false, 0x0, b"lo", mask));
    // Two compressed messages sharing one deflate context, the second over 64 KB inflated.
    let compressed = deflate_message(&mut compress, b"compressed text compressed text");
    wire.extend(ws_frame(true, true, 0x1, &compressed, mask));
    let compressed = deflate_message(&mut compress, &big);
    wire.extend(ws_frame(true, true, 0x2, &compressed, mask));
    let mut close = 4000u16.to_be_bytes().to_vec();
    close.extend(b"done");
    wire.extend(ws_frame(true, false, 0x8, &close, mask));

    // Odd-sized writes, so frames and headers split across reads.
    for piece in wire.chunks(7) {
        tls.write_all(piece).await.unwrap();
    }
    // TLS may hold the last records back until flushed.
    tls.flush().await.unwrap();
    let mut echoed = vec![0u8; wire.len()];
    tls.read_exact(&mut echoed).await.unwrap();
    assert_eq!(echoed, wire, "the client gets back exactly what the server sent");
    assert_eq!(*received.lock().unwrap(), wire, "the server gets exactly what the client sent");
    drop(tls);

    let events = h.flow_events();
    // The server sent the client's masked frames back, so both sides recorded the same.
    for direction in [MessageDirection::Client, MessageDirection::Server] {
        let sent = messages(&events, direction);
        let kinds: Vec<_> = sent.iter().map(|m| m.kind.clone()).collect();
        assert_eq!(
            kinds,
            vec![
                MessageKind::WebSocketPing,
                MessageKind::WebSocketText,
                MessageKind::WebSocketText,
                MessageKind::WebSocketBinary,
                MessageKind::WebSocketClose { code: Some(4000), reason: "done".into() },
            ],
            "{direction:?}"
        );
        assert_eq!(&sent[1].data[..], b"Hello");
        assert_eq!(sent[1].size, 5);
        assert_eq!(&sent[2].data[..], b"compressed text compressed text");
        assert!(sent[2].compressed && sent[2].error.is_none(), "{:?}", sent[2].error);
        assert_eq!(&sent[3].data[..], &big[..], "inflated with the first message's context");
        assert!(sent[3].size < big.len() as u64, "size on the wire, compressed");
    }
    let error = find!(events, ProxyEvent::StreamEnd { error, .. } => error.clone());
    assert_eq!(error, None, "ended by the close frames");
    })
    .await
}

/// Round trips over a WebSocket through the proxy, in microseconds, sorted.
async fn websocket_round_trips(websocket_capture: bool, n: usize) -> Vec<u128> {
    let h = Harness::start_with(1024 * 1024, |c| c.websocket_capture = websocket_capture);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let tcp = h.connect_tunnel(upstream.port()).await;
    let tls = TlsConnector::from(h.tls_client_config())
        .connect(ServerName::try_from("localhost").unwrap(), tcp)
        .await
        .unwrap();
    let url = format!("wss://localhost:{}/ws", upstream.port());
    let (mut ws, _) = tokio_tungstenite::client_async(url.as_str(), tls).await.unwrap();
    let payload = "x".repeat(256);
    let mut times = Vec::with_capacity(n);
    for i in 0..n + 100 {
        let start = std::time::Instant::now();
        ws.send(Message::text(payload.clone())).await.unwrap();
        ws.next().await.unwrap().unwrap();
        // The first hundred warm up.
        if i >= 100 {
            times.push(start.elapsed().as_micros());
        }
    }
    ws.close(None).await.unwrap();
    times.sort_unstable();
    times
}

#[tokio::test(flavor = "multi_thread")]
async fn websocket_capture_adds_no_measurable_latency() {
    within(async {
        const N: usize = 2000;
        let blind = websocket_round_trips(false, N).await;
        let captured = websocket_round_trips(true, N).await;
        let pct = |t: &[u128], p: usize| t[(t.len() * p / 100).min(t.len() - 1)];
        eprintln!(
            "WebSocket round trip through the proxy, {N} x 256 B text, microseconds: \
        blind splice p50 {} p90 {} p99 {}; captured p50 {} p90 {} p99 {}",
            pct(&blind, 50),
            pct(&blind, 90),
            pct(&blind, 99),
            pct(&captured, 50),
            pct(&captured, 90),
            pct(&captured, 99),
        );
        // Generous, so a busy machine does not fail it: within a millisecond of the blind splice at
        // the median.
        assert!(pct(&captured, 50) < pct(&blind, 50) + 1000);
    })
    .await
}

/// An event stream whose chunks the test sends one at a time.
fn event_stream(chunks: tokio::sync::mpsc::UnboundedReceiver<&'static str>) -> Response<TestBody> {
    let frames = futures_util::stream::unfold(chunks, |mut chunks| async move {
        let chunk = chunks.recv().await?;
        Some((Ok(Frame::data(Bytes::from(chunk))), chunks))
    });
    Response::builder()
        .header(CONTENT_TYPE, "text/event-stream")
        .body(BodyExt::boxed(StreamBody::new(frames)))
        .unwrap()
}

/// The next event of a flow, skipping body chunks and headers.
fn next_stream_message(h: &Harness) -> StreamMessage {
    loop {
        match h.events.recv_timeout(Duration::from_secs(10)).expect("no message") {
            ProxyEvent::Message { message, .. } => return message,
            ProxyEvent::ResponseBodyComplete { .. } => panic!("the stream ended first"),
            _ => {}
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn server_sent_events_are_recorded_as_they_arrive() {
    within(async {
        let h = Harness::start(1024);
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let rx = Arc::new(std::sync::Mutex::new(Some(rx)));
        let handler = move |_req| {
            let rx = rx.lock().unwrap().take().unwrap();
            async move { Ok::<_, Infallible>(event_stream(rx)) }
        };
        let upstream =
            spawn_upstream_with(Some(h.pki.server.clone()), Arc::new(AtomicUsize::new(0)), handler)
                .await;
        let url = format!("https://localhost:{}/events", upstream.port());
        let mut resp = h.client().get(&url).send().await.unwrap();

        tx.send("event: greet\nid: 1\ndata: hello\n").unwrap();
        tx.send("data: world\n\n").unwrap();
        // Recorded while the stream is still open.
        let first = next_stream_message(&h);
        assert_eq!(&first.data[..], b"hello\nworld");
        assert_eq!(
            first.kind,
            MessageKind::SseEvent {
                event: Some("greet".into()),
                id: Some("1".into()),
                retry: None,
                raw: "event: greet\nid: 1\ndata: hello\ndata: world\n\n".into(),
            }
        );
        tokio::time::sleep(Duration::from_millis(500)).await;
        tx.send(": a comment\r\nretry: 1500\r\ndata: two\r\n\r\n").unwrap();
        let second = next_stream_message(&h);
        assert_eq!(&second.data[..], b"two");
        assert!(matches!(second.kind, MessageKind::SseEvent { retry: Some(1500), .. }));
        drop(tx);

        let mut body = Vec::new();
        while let Some(chunk) = resp.chunk().await.unwrap() {
            body.extend_from_slice(&chunk);
        }
        assert!(body.ends_with(b"data: two\r\n\r\n"), "the client gets the stream unchanged");
        let events = h.flow_events();
        let error = find!(events, ProxyEvent::ResponseBodyComplete { error, .. } => error.clone());
        assert_eq!(error, None);
    })
    .await
}

/// A gRPC message on the wire: its five-byte prefix, then `payload`.
fn grpc_frame(flag: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = vec![flag];
    out.extend((payload.len() as u32).to_be_bytes());
    out.extend(payload);
    out
}

/// A protobuf message with one string field, number 1, as `HelloRequest { name }` encodes.
fn proto_string(value: &str) -> Vec<u8> {
    let mut out = vec![0x0a, value.len() as u8];
    out.extend(value.as_bytes());
    out
}

/// A gRPC server for `pkg.Greeter`: `SayHello` answers once, `StreamHellos` three times, and
/// `Fail` at once with a NOT_FOUND status in its headers.
async fn greeter(req: Request<Incoming>) -> Result<Response<TestBody>, Infallible> {
    let path = req.uri().path().to_string();
    let web = req.headers()[CONTENT_TYPE].to_str().unwrap().starts_with("application/grpc-web");
    // Asked for by a header of the test's own: clients built with gzip support ask for it on
    // every request.
    let gzip = req.headers().contains_key("x-test-gzip");
    let request = req.into_body().collect().await.unwrap().to_bytes();
    let request = if web { BASE64.decode(&request).unwrap() } else { request.to_vec() };
    let name = String::from_utf8_lossy(&request[7..]).into_owned();
    let replies: Vec<String> = match path.as_str() {
        "/pkg.Greeter/SayHello" => vec![format!("Hello {name}")],
        "/pkg.Greeter/StreamHellos" => (1..=3).map(|i| format!("Hello {name} #{i}")).collect(),
        _ => {
            return Ok(Response::builder()
                .header(CONTENT_TYPE, "application/grpc")
                .header("grpc-status", "5")
                .header("grpc-message", "no%20such%20greeter")
                .body(full(Bytes::new()))
                .unwrap());
        }
    };
    if web {
        // gRPC-Web's text flavor: each frame base64 of its own, the trailers in the last.
        let mut body = String::new();
        for reply in &replies {
            body.push_str(&BASE64.encode(grpc_frame(0, &proto_string(reply))));
        }
        body.push_str(&BASE64.encode(grpc_frame(0x80, b"grpc-status: 0\r\ngrpc-message: \r\n")));
        let resp = Response::builder().header(CONTENT_TYPE, "application/grpc-web-text");
        // Compressed for HTTP as a whole when the client accepts it, as a CDN does.
        if gzip {
            let mut encoder =
                flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            std::io::Write::write_all(&mut encoder, body.as_bytes()).unwrap();
            let body = encoder.finish().unwrap();
            return Ok(resp.header("content-encoding", "gzip").body(full(body)).unwrap());
        }
        return Ok(resp.body(full(body)).unwrap());
    }
    let frames = futures_util::stream::iter(replies)
        .then(|reply| async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            Ok(Frame::data(Bytes::from(grpc_frame(0, &proto_string(&reply)))))
        })
        .chain(futures_util::stream::once(async {
            let mut trailers = hyper::HeaderMap::new();
            trailers.insert("grpc-status", HeaderValue::from_static("0"));
            Ok(Frame::trailers(trailers))
        }));
    Ok(Response::builder()
        .header(CONTENT_TYPE, "application/grpc")
        .body(BodyExt::boxed(StreamBody::new(frames)))
        .unwrap())
}

async fn grpc_call(
    sender: &mut http2::SendRequest<TestBody>,
    port: u16,
    method: &str,
    name: &str,
) -> (Vec<u8>, Option<hyper::HeaderMap>, hyper::HeaderMap) {
    let req = Request::builder()
        .method("POST")
        .uri(format!("https://localhost:{port}/pkg.Greeter/{method}"))
        .header(CONTENT_TYPE, "application/grpc")
        .header("te", "trailers")
        .body(full(grpc_frame(0, &proto_string(name))))
        .unwrap();
    let resp = sender.send_request(req).await.unwrap();
    let headers = resp.headers().clone();
    let collected = resp.into_body().collect().await.unwrap();
    let trailers = collected.trailers().cloned();
    (collected.to_bytes().to_vec(), trailers, headers)
}

#[tokio::test(flavor = "multi_thread")]
async fn grpc_messages_and_status_are_recorded() {
    within(async {
        let h = Harness::start(1024);
        let upstream =
            spawn_upstream_with(Some(h.pki.server.clone()), Arc::new(AtomicUsize::new(0)), greeter)
                .await;
        let port = upstream.port();
        let mut sender = h.h2_client(port).await;

        let (body, trailers, _) = grpc_call(&mut sender, port, "SayHello", "Ada").await;
        assert_eq!(body, grpc_frame(0, &proto_string("Hello Ada")));
        assert_eq!(trailers.unwrap()["grpc-status"], "0", "trailers pass through");
        let events = h.flow_events();
        assert_eq!(find!(events, ProxyEvent::StreamStart { kind, .. } => *kind), StreamKind::Grpc);
        let sent = messages(&events, MessageDirection::Client);
        assert_eq!(sent.len(), 1);
        assert_eq!((&sent[0].data[..], sent[0].size), (&proto_string("Ada")[..], 5));
        let received = messages(&events, MessageDirection::Server);
        assert_eq!(received.len(), 2);
        assert_eq!(&received[0].data[..], &proto_string("Hello Ada")[..]);
        assert_eq!(received[1].kind, MessageKind::GrpcTrailers { status: Some(0), message: None });

        let (_, _, _) = grpc_call(&mut sender, port, "StreamHellos", "Bo").await;
        let events = h.flow_events();
        let received = messages(&events, MessageDirection::Server);
        let replies: Vec<_> = received.iter().map(|m| m.data.clone()).collect();
        assert_eq!(replies.len(), 4);
        for (i, reply) in replies[..3].iter().enumerate() {
            assert_eq!(&reply[..], &proto_string(&format!("Hello Bo #{}", i + 1))[..]);
        }

        let (body, _, headers) = grpc_call(&mut sender, port, "Fail", "Cy").await;
        assert!(body.is_empty());
        assert_eq!(headers["grpc-status"], "5");
        let events = h.flow_events();
        let received = messages(&events, MessageDirection::Server);
        assert_eq!(
            received[0].kind,
            MessageKind::GrpcTrailers { status: Some(5), message: Some("no such greeter".into()) }
        );
    })
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn grpc_web_text_is_recorded() {
    within(async {
        let h = Harness::start(1024);
        let upstream =
            spawn_upstream_with(Some(h.pki.server.clone()), Arc::new(AtomicUsize::new(0)), greeter)
                .await;
        let url = format!("https://localhost:{}/pkg.Greeter/StreamHellos", upstream.port());
        // Plain, then with the whole response gzipped for HTTP.
        for gzip in [false, true] {
            let mut req = h
                .client()
                .post(&url)
                .header(CONTENT_TYPE, "application/grpc-web-text")
                .body(BASE64.encode(grpc_frame(0, &proto_string("Di"))));
            if gzip {
                req = req.header("x-test-gzip", "1");
            }
            let resp = req.send().await.unwrap();
            assert_eq!(resp.status(), 200);
            resp.bytes().await.unwrap();

            let events = h.flow_events();
            // As the server sent it: a client with gzip support may undo it before the test sees it.
            let encoding =
                headers(&events, false).into_iter().find(|(n, _)| n == "content-encoding");
            assert_eq!(encoding.is_some(), gzip, "the response passed compressed");
            let kind = find!(events, ProxyEvent::StreamStart { kind, .. } => *kind);
            assert_eq!(kind, StreamKind::GrpcWeb);
            let sent = messages(&events, MessageDirection::Client);
            assert_eq!(&sent[0].data[..], &proto_string("Di")[..]);
            let received = messages(&events, MessageDirection::Server);
            assert_eq!(received.len(), 4, "gzip: {gzip}");
            assert_eq!(&received[2].data[..], &proto_string("Hello Di #3")[..]);
            assert_eq!(
                received[3].kind,
                MessageKind::GrpcTrailers { status: Some(0), message: Some(String::new()) }
            );
        }
    })
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn pinned_client_falls_back_to_passthrough() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let url = format!("https://localhost:{}/hello", upstream.port());
    let pinned = h.client_trusting(&h.pki.ca_pem);

    assert!(pinned.get(&url).send().await.is_err());

    let mut body = None;
    for _ in 0..40 {
        if let Ok(resp) = pinned.get(&url).send().await {
            body = Some(resp.text().await.unwrap());
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(body.as_deref(), Some("hello"));
    // Passed through, it is a tunnelled flow, recorded without its contents.
    drop(pinned);
    let events = h.flow_events();
    let authority = find!(events, ProxyEvent::TunnelStart { authority, .. } => authority.clone());
    assert_eq!(authority, format!("localhost:{}", upstream.port()));
    let (sent, received) =
        find!(events, ProxyEvent::TunnelEnd { sent, received, .. } => (*sent, *received));
    assert!(sent > 0 && received > 0, "sent {sent}, received {received}");
    assert!(!events.iter().any(|e| matches!(e, ProxyEvent::RequestStart { .. })));
}

/// TLS straight to the upstream server through a CONNECT tunnel, trusting only the server's own
/// CA, as a client that never trusted the proxy's does.
async fn upstream_tls(
    h: &Harness,
    port: u16,
    alpn: &[&[u8]],
) -> tokio_rustls::client::TlsStream<TcpStream> {
    let mut roots = RootCertStore::empty();
    roots.add(h.pki.ca_der.clone()).unwrap();
    let mut config = ClientConfig::builder_with_provider(ring())
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_root_certificates(roots)
        .with_no_client_auth();
    config.alpn_protocols = alpn.iter().map(|p| p.to_vec()).collect();
    let name = ServerName::try_from("localhost").unwrap();
    let tcp = h.connect_tunnel(port).await;
    TlsConnector::from(Arc::new(config)).connect(name, tcp).await.expect("TLS to the server")
}

/// `GET /hello` over HTTP/1.1 on `tls`, closing the connection after.
async fn get_hello_and_close(mut tls: tokio_rustls::client::TlsStream<TcpStream>) -> String {
    tls.write_all(b"GET /hello HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut response = Vec::new();
    let _ = tls.read_to_end(&mut response).await;
    String::from_utf8_lossy(&response).into_owned()
}

fn with_policy(entries: &[&str]) -> impl FnOnce(&mut ProxyConfig) {
    let policy = DecryptPolicy::parse(entries).unwrap();
    move |config| config.decrypt = policy
}

#[tokio::test(flavor = "multi_thread")]
async fn an_empty_decrypt_list_tunnels_https_untouched() {
    within(async {
        let h = Harness::start_with(1024, with_policy(&[]));
        let upstream = spawn_upstream(Some(h.pki.server.clone())).await;

        // The server's own certificate arrives, so no CA of the proxy's is involved.
        let tls = upstream_tls(&h, upstream.port(), &[b"http/1.1"]).await;
        let response = get_hello_and_close(tls).await;
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        assert!(response.ends_with("hello"), "{response}");

        let events = h.flow_events();
        let (connection, authority) = find!(events, ProxyEvent::TunnelStart { connection, authority, .. } => (*connection, authority.clone()));
        assert_eq!(connection, 1);
        assert_eq!(authority, format!("localhost:{}", upstream.port()));
        let (host, port, reason) = find!(events, ProxyEvent::TunnelStart { host, port, reason, .. } => (host.clone(), *port, reason.clone()));
        assert_eq!((host.as_str(), port), ("localhost", upstream.port()));
        assert_eq!(reason, TunnelReason::NotListed);
        let (sent, received, error, reconnect) = find!(events, ProxyEvent::TunnelEnd { sent, received, error, reconnect_requested, .. } => (*sent, *received, error.clone(), *reconnect_requested));
        assert_eq!(error, None);
        assert!(!reconnect);
        // The ClientHello and request one way, the certificate and response the other.
        assert!(sent > 100, "sent {sent}");
        assert!(received as usize > response.len(), "received {received}");
        assert!(!events.iter().any(|e| matches!(e, ProxyEvent::RequestStart { .. })));
    })
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn an_excluded_host_is_tunnelled_with_the_exclusion_that_kept_it_out() {
    within(async {
        let mut entries = vec!["*", "!host:localhost"];
        entries.extend(BUILT_IN_EXCLUSIONS.iter().map(|(e, _)| *e));
        let h = Harness::start_with(1024, with_policy(&entries));
        let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
        let tls = upstream_tls(&h, upstream.port(), &[b"http/1.1"]).await;
        assert!(get_hello_and_close(tls).await.ends_with("hello"));
        let events = h.flow_events();
        let reason = find!(events, ProxyEvent::TunnelStart { reason, .. } => reason.clone());
        let entry = "!host:localhost".to_string();
        assert_eq!(reason, TunnelReason::Excluded { entry, built_in: false });
    })
    .await
}

/// A tunnel closed on request ends at once, both sides closed, marked as asked to reconnect.
#[tokio::test(flavor = "multi_thread")]
async fn closing_a_tunnel_ends_it_for_a_reconnect() {
    within(async {
        let h = Harness::start_with(1024, with_policy(&[]));
        let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
        let mut tls = upstream_tls(&h, upstream.port(), &[b"http/1.1"]).await;
        let started = h.events.recv_timeout(Duration::from_secs(10)).unwrap();
        let ProxyEvent::TunnelStart { id, .. } = started else {
            panic!("expected a tunnel, got {started:?}");
        };
        assert_eq!(h.proxy.close_tunnels(&[id + 100]), 0, "no such tunnel");
        assert_eq!(h.proxy.close_tunnels(&[id]), 1);
        // The client sees its connection end.
        let mut rest = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(5), tls.read_to_end(&mut rest))
            .await
            .expect("the tunnel stayed open");
        let events = h.flow_events();
        let (end_id, error, reconnect) = find!(events, ProxyEvent::TunnelEnd { id, error, reconnect_requested, .. } => (*id, error.clone(), *reconnect_requested));
        assert_eq!((end_id, error, reconnect), (id, None, true));
        assert_eq!(h.proxy.close_tunnels(&[id]), 0, "closed already");
    })
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn a_tunnelled_host_passes_http2_through() {
    within(async {
        let h = Harness::start_with(1024, with_policy(&["host:example.com"]));
        let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
        let tls = upstream_tls(&h, upstream.port(), &[b"h2", b"http/1.1"]).await;
        assert_eq!(tls.get_ref().1.alpn_protocol(), Some(&b"h2"[..]), "the server's ALPN");
        let (mut sender, conn) =
            http2::handshake(TokioExecutor::new(), TokioIo::new(tls)).await.unwrap();
        let conn = tokio::spawn(conn);
        let req = Request::get(format!("https://localhost:{}/hello", upstream.port()))
            .body(full(Bytes::new()))
            .unwrap();
        let resp = sender.send_request(req).await.unwrap();
        assert_eq!(resp.version(), Version::HTTP_2);
        assert_eq!(resp.into_body().collect().await.unwrap().to_bytes(), "hello");
        drop(sender);
        let _ = conn.await;

        let events = h.flow_events();
        find!(events, ProxyEvent::TunnelStart { .. } => ());
        let error = find!(events, ProxyEvent::TunnelEnd { error, .. } => error.clone());
        assert_eq!(error, None);
    })
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn a_listed_host_is_decrypted_and_others_tunnelled() {
    within(async {
        let h = Harness::start_with(1024, with_policy(&["host:localhost"]));
        let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
        let url = format!("https://localhost:{}/hello", upstream.port());
        assert_eq!(h.client().get(&url).send().await.unwrap().text().await.unwrap(), "hello");
        let events = h.flow_events();
        let flow_url = find!(events, ProxyEvent::RequestStart { url, .. } => url.clone());
        assert_eq!(flow_url, url);

        // Only from the next connection on.
        h.proxy.set_decrypt_policy(DecryptPolicy::parse(&["host:*.example.com"]).unwrap());
        let tls = upstream_tls(&h, upstream.port(), &[b"http/1.1"]).await;
        assert!(get_hello_and_close(tls).await.ends_with("hello"));
        let events = h.flow_events();
        find!(events, ProxyEvent::TunnelEnd { .. } => ());
    })
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn an_app_entry_decrypts_that_app_alone() {
    within(async {
        let h = Harness::start_with(1024, |config| {
            config.decrypt = DecryptPolicy::parse(&["app:com.example.curl"]).unwrap();
            // The first connection is from the listed app, the rest from another.
            config.app_of = Some(Arc::new(|connection| {
                let bundle_id = if connection == 1 { "com.example.curl" } else { "com.other" };
                Some(DecryptApp { name: "curl".into(), bundle_id: Some(bundle_id.into()) })
            }));
        });
        let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
        let url = format!("https://localhost:{}/hello", upstream.port());
        let client = h.client();
        assert_eq!(client.get(&url).send().await.unwrap().text().await.unwrap(), "hello");
        let events = h.flow_events();
        find!(events, ProxyEvent::RequestStart { .. } => ());
        drop(client);

        let tls = upstream_tls(&h, upstream.port(), &[b"http/1.1"]).await;
        assert!(get_hello_and_close(tls).await.ends_with("hello"));
        let events = h.flow_events();
        let connection = find!(events, ProxyEvent::TunnelStart { connection, .. } => *connection);
        assert_eq!(connection, 2);
    })
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn a_tunnel_to_nowhere_is_a_failed_flow() {
    within(async {
        let h = Harness::start_with(1024, with_policy(&[]));
        // A port nothing listens on.
        let closed = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap().port();
        let mut tcp = h.connect_tunnel(closed).await;
        let _ = tcp.write_all(b"\x16\x03\x01").await;
        let mut rest = Vec::new();
        let _ = tcp.read_to_end(&mut rest).await;
        let events = h.flow_events();
        let (received, error) =
            find!(events, ProxyEvent::TunnelEnd { received, error, .. } => (*received, error.clone()));
        assert_eq!(received, 0);
        assert!(error.is_some(), "{events:#?}");
    })
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn certificate_alert_passes_through_on_the_next_connection() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let port = upstream.port();
    let mut roots = RootCertStore::empty();
    roots.add(h.pki.ca_der.clone()).unwrap();
    let config = ClientConfig::builder_with_provider(ring())
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let pinned = TlsConnector::from(Arc::new(config));
    let name = ServerName::try_from("localhost").unwrap();

    assert!(pinned.connect(name.clone(), h.connect_tunnel(port).await).await.is_err());
    let failed = h.events.recv_timeout(Duration::from_secs(10)).unwrap();
    let ProxyEvent::HandshakeFailed { id: rejected, authority, rejection, connection, .. } = failed
    else {
        panic!("expected the refused handshake, got {failed:?}");
    };
    assert_eq!(authority, format!("localhost:{port}"));
    assert_eq!(rejection.as_deref(), Some("unknown_ca"));
    assert_eq!(connection, 1);
    assert_eq!(h.proxy.passthrough(), vec![format!("localhost:{port}")]);
    let tls = pinned
        .connect(name, h.connect_tunnel(port).await)
        .await
        .expect("one certificate alert should be enough to pass the host through");
    let started = h.events.recv_timeout(Duration::from_secs(10)).unwrap();
    let ProxyEvent::TunnelStart { reason, .. } = started else {
        panic!("expected a tunnel, got {started:?}");
    };
    assert_eq!(reason, TunnelReason::Rejected { rejected_by: rejected });
    drop(tls);

    // Forgotten, the address is intercepted again, and a refusal is a new flow.
    let addr = format!("localhost:{port}");
    assert!(!h.proxy.forget_passthrough_address("localhost:1"));
    assert!(h.proxy.forget_passthrough_address(&addr));
    assert!(h.proxy.passthrough().is_empty());
}

/// Clients refusing the certificate together make one flow for the address, not one each.
#[tokio::test(flavor = "multi_thread")]
async fn concurrent_refusals_are_one_flow() {
    within(async {
        let h = Harness::start(1024);
        let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
        let port = upstream.port();
        let mut roots = RootCertStore::empty();
        roots.add(h.pki.ca_der.clone()).unwrap();
        let config = ClientConfig::builder_with_provider(ring())
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let pinned = TlsConnector::from(Arc::new(config));
        let name = ServerName::try_from("localhost").unwrap();
        // Every connection is made before any handshake starts, so they all race.
        let mut tunnels = Vec::new();
        for _ in 0..8 {
            tunnels.push(h.connect_tunnel(port).await);
        }
        let attempts = tunnels.into_iter().map(|tcp| {
            let (pinned, name) = (pinned.clone(), name.clone());
            tokio::spawn(async move { pinned.connect(name, tcp).await.map(drop) })
        });
        for attempt in attempts.collect::<Vec<_>>() {
            let _ = attempt.await.unwrap();
        }
        let mut failed = 0;
        while let Ok(event) = h.events.recv_timeout(Duration::from_millis(300)) {
            failed += usize::from(matches!(event, ProxyEvent::HandshakeFailed { .. }));
        }
        assert_eq!(failed, 1);
    })
    .await
}

/// SChannel (native-tls on Windows) checks the certificate only after sending its Finished, so
/// the proxy sees a completed handshake and then a hang-up instead of an alert.
#[tokio::test(flavor = "multi_thread")]
async fn hang_up_after_the_handshake_passes_through() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let port = upstream.port();
    let name = ServerName::try_from("localhost").unwrap();

    let addr = format!("localhost:{port}");
    let hangs_up = TlsConnector::from(h.tls_client_config());
    for state in [(1, false), (0, true)] {
        let tls = hangs_up.connect(name.clone(), h.connect_tunnel(port).await).await.unwrap();
        drop(tls);
        h.wait_for_handshake_state(&addr, state).await;
    }
    // Recorded once, as the second hang-up passes it through.
    let failed = h.events.recv_timeout(Duration::from_secs(10)).unwrap();
    let ProxyEvent::HandshakeFailed { rejection, .. } = failed else {
        panic!("expected the refused handshake, got {failed:?}");
    };
    assert_eq!(rejection.as_deref(), Some("hang_up"));
    assert!(h.events.recv_timeout(Duration::from_millis(100)).is_err());

    let mut roots = RootCertStore::empty();
    roots.add(h.pki.ca_der.clone()).unwrap();
    let config = ClientConfig::builder_with_provider(ring())
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_root_certificates(roots)
        .with_no_client_auth();
    TlsConnector::from(Arc::new(config))
        .connect(name, h.connect_tunnel(port).await)
        .await
        .expect("two hang-ups after the handshake should pass the host through");

    // Once the CA is trusted the host is intercepted again.
    h.proxy.forget_passthrough();
    assert_eq!(h.proxy.handshake_state(&addr), (0, false));
}

#[tokio::test(flavor = "multi_thread")]
async fn abandoned_handshake_does_not_disable_capture() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let port = upstream.port();

    let mut tcp = h.connect_tunnel(port).await;
    let mut hello = Vec::new();
    rustls::ClientConnection::new(
        h.tls_client_config(),
        ServerName::try_from("localhost").unwrap(),
    )
    .unwrap()
    .write_tls(&mut hello)
    .unwrap();
    tcp.write_all(&hello).await.unwrap();
    let mut server_hello = [0u8; 1];
    tcp.read_exact(&mut server_hello).await.unwrap();
    drop(tcp);
    tokio::time::sleep(Duration::from_millis(100)).await;

    let url = format!("https://localhost:{port}/hello");
    assert_eq!(h.client().get(&url).send().await.unwrap().text().await.unwrap(), "hello");
    let events = h.flow_events();
    assert_eq!(find!(events, ProxyEvent::ResponseStart { status, .. } => *status), 200);
}

#[tokio::test(flavor = "multi_thread")]
async fn server_first_tunnel_does_not_wait_for_the_client() {
    let h = Harness::start(1024);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        socket.write_all(b"220 ready\r\n").await.unwrap();
        let mut buf = [0u8; 64];
        let n = socket.read(&mut buf).await.unwrap();
        socket.write_all(&buf[..n]).await.unwrap();
    });

    let mut tcp = h.connect_tunnel(port).await;
    let mut greeting = [0u8; 11];
    tokio::time::timeout(Duration::from_secs(5), tcp.read_exact(&mut greeting))
        .await
        .expect("the server's greeting never arrived")
        .unwrap();
    assert_eq!(&greeting, b"220 ready\r\n");
    tcp.write_all(b"EHLO yaak\r\n").await.unwrap();
    let mut echo = [0u8; 11];
    tcp.read_exact(&mut echo).await.unwrap();
    assert_eq!(&echo, b"EHLO yaak\r\n");
}

#[tokio::test(flavor = "multi_thread")]
async fn plain_http_get() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(None).await;
    let url = format!("http://127.0.0.1:{}/hello", upstream.port());

    assert_eq!(h.client().get(&url).send().await.unwrap().text().await.unwrap(), "hello");

    let events = h.flow_events();
    assert_eq!(find!(events, ProxyEvent::RequestStart { url, .. } => url.clone()), url);
    let (status, remote_addr) = find!(events,
        ProxyEvent::ResponseStart { status, remote_addr, .. } => (*status, *remote_addr));
    assert_eq!((status, remote_addr), (200, Some(upstream)));
}

#[tokio::test(flavor = "multi_thread")]
async fn unreachable_upstream_is_an_error() {
    let h = Harness::start(1024);
    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap();
    let url = format!("http://{closed}/");

    let resp = h.client().get(&url).send().await.unwrap();
    assert_eq!(resp.status(), 502);

    let events = h.flow_events();
    let error = find!(events, ProxyEvent::Error { error, .. } => error.clone());
    assert!(error.to_lowercase().contains("connect"), "{error}");
    assert!(!events.iter().any(|e| matches!(e, ProxyEvent::ResponseStart { .. })));
}

/// Telegram's HTTP transport request, `POST /api` with only `Host` to say where it goes, from the
/// failing flows. `host` replaces Telegram's `149.154.175.58:80`.
fn telegram_request(host: Option<&str>, path: &str, payload: &[u8]) -> Request<TestBody> {
    let mut builder = Request::post(path);
    if let Some(host) = host {
        builder = builder.header("host", host);
    }
    builder
        .header("content-length", payload.len())
        .header("content-type", "application/x-www-form-urlencoded")
        .header("connection", "Keep-Alive")
        .header("accept-encoding", "gzip, deflate")
        .header("accept-language", "en-US,*")
        .header("user-agent", "Mozilla/5.0")
        .body(full(payload.to_vec()))
        .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn plain_http_bare_path_is_sent_to_host() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(None).await;
    let payload = [0xefu8; 44];

    let resp = h.send_as_written(telegram_request(Some(&upstream.to_string()), "/echo", &payload));
    let resp = resp.await;
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.into_body().collect().await.unwrap().to_bytes(), &payload[..]);

    let events = h.flow_events();
    let url = find!(events, ProxyEvent::RequestStart { url, .. } => url.clone());
    assert_eq!(url, format!("http://{upstream}/echo"));
    let (status, remote_addr) = find!(events,
        ProxyEvent::ResponseStart { status, remote_addr, .. } => (*status, *remote_addr));
    assert_eq!((status, remote_addr), (200, Some(upstream)));
    assert_eq!(body(&events, true), (payload.to_vec(), 44));
}

#[tokio::test(flavor = "multi_thread")]
async fn plain_http_bare_path_without_host_is_a_bad_request() {
    let h = Harness::start(1024);

    let resp = h.send_as_written(telegram_request(None, "/api", &[0xefu8; 44])).await;
    assert_eq!(resp.status(), 400);
    assert_eq!(resp.headers()[CONTENT_TYPE], "text/plain; charset=utf-8");
    assert_eq!(resp.into_body().collect().await.unwrap().to_bytes(), "no host in request");

    let events = h.flow_events();
    assert_eq!(find!(events, ProxyEvent::RequestStart { url, .. } => url.clone()), "/api");
    let error = find!(events, ProxyEvent::Error { error, .. } => error.clone());
    assert_eq!(error, "no host in request");
    assert!(!events.iter().any(|e| matches!(e, ProxyEvent::ResponseStart { .. })));
}

/// A request whose connection upstream is routed back into the proxy, as Private Relay does with
/// port 80 while the system proxy is on, arrives again with the engine's `Via` mark. Sending
/// that on would loop forever. It is refused without a flow of its own, so the loop shows as the
/// client's request answered with a 508.
#[tokio::test(flavor = "multi_thread")]
async fn plain_http_request_looped_back_to_the_proxy_stops() {
    let h = Harness::start(1024);
    let url = format!("http://127.0.0.1:{}/api", h.proxy.port);

    let resp = h.client().post(&url).body(vec![0xefu8; 44]).send().await.unwrap();
    assert_eq!(resp.status(), 508);
    assert_eq!(resp.text().await.unwrap(), "request looped back to Yaak Proxy");

    let events = h.flow_events();
    let starts: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            ProxyEvent::RequestStart { url, .. } => Some(url.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(starts, [url]);
    assert_eq!(find!(events, ProxyEvent::ResponseStart { status, .. } => *status), 508);
    assert!(!events.iter().any(|e| matches!(e, ProxyEvent::Error { .. })));
    let (body, _) = body(&events, false);
    assert_eq!(body, b"request looped back to Yaak Proxy");
}

/// The same loop from a client that sends a bare path, as Telegram did.
#[tokio::test(flavor = "multi_thread")]
async fn bare_path_request_looped_back_to_the_proxy_stops() {
    let h = Harness::start(1024);
    let host = format!("127.0.0.1:{}", h.proxy.port);

    let resp = h.send_as_written(telegram_request(Some(&host), "/api", &[0xefu8; 44])).await;
    assert_eq!(resp.status(), 508);

    let events = h.flow_events();
    let flows: HashSet<u64> = events.iter().map(flow_id).collect();
    assert_eq!(flows.len(), 1, "{events:?}");
    assert_eq!(find!(events, ProxyEvent::ResponseStart { status, .. } => *status), 508);
}

// -- HTTP/2 clients --

fn h2_request(method: &str, port: u16, path: &str, body: TestBody) -> Request<TestBody> {
    Request::builder()
        .method(method)
        .uri(format!("https://localhost:{port}{path}"))
        .body(body)
        .unwrap()
}

/// The upstream test server, speaking HTTP/1.1 alone.
fn h1_only(server: &ServerConfig) -> Arc<ServerConfig> {
    let mut server = server.clone();
    server.alpn_protocols = vec![b"http/1.1".to_vec()];
    Arc::new(server)
}

#[tokio::test(flavor = "multi_thread")]
async fn h2_client_to_an_h2_upstream() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let port = upstream.port();
    let mut client = h.h2_client(port).await;

    let resp = client.send_request(h2_request("GET", port, "/authority", full(""))).await.unwrap();
    assert_eq!((resp.status(), resp.version()), (StatusCode::OK, Version::HTTP_2));
    let text = resp.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(text, format!("authority=localhost:{port} host=none"));

    let events = h.flow_events();
    let (method, url, version, connection) = find!(events,
        ProxyEvent::RequestStart { method, url, http_version, connection, .. } =>
            (method.clone(), url.clone(), http_version.clone(), *connection));
    assert_eq!(method, "GET");
    assert_eq!(url, format!("https://localhost:{port}/authority"));
    assert_eq!(version, "HTTP/2");
    assert_eq!(connection, 1);
    // `:authority` is shown as `Host`, once and first, as an HTTP/1.1 request has it.
    let request_headers = headers(&events, true);
    assert_eq!(request_headers.first(), Some(&("host".to_string(), format!("localhost:{port}"))));
    assert_eq!(request_headers.iter().filter(|(name, _)| name == "host").count(), 1);

    let (status, version, remote_addr) = find!(events,
        ProxyEvent::ResponseStart { status, http_version, remote_addr, .. } =>
            (*status, http_version.clone(), *remote_addr));
    assert_eq!((status, version.as_str(), remote_addr), (200, "HTTP/2", Some(upstream)));
    let (size, error, cancelled) = find!(events,
        ProxyEvent::ResponseBodyComplete { size, error, cancelled, .. } =>
            (*size, error.clone(), *cancelled));
    assert_eq!((size, error, cancelled), (text.len() as u64, None, false));
    assert_eq!(body(&events, false).0, text);

    // The connection opened for it, timed from the flow's start, and its TLS.
    let (connect, tls, version, cipher) = find!(events,
        ProxyEvent::UpstreamConnection { elapsed_connect_ms, elapsed_tls_ms, tls_version, tls_cipher, .. } =>
            (*elapsed_connect_ms, *elapsed_tls_ms, tls_version.clone(), tls_cipher.clone()));
    let headers_at = find!(events, ProxyEvent::ResponseStart { elapsed_ms, .. } => *elapsed_ms);
    assert!(connect.unwrap() <= tls.unwrap() && tls.unwrap() <= headers_at);
    assert_eq!(version.as_deref(), Some("TLSv1.3"));
    assert!(cipher.unwrap().starts_with("TLS13_"));

    // The next request shares it: no connect or handshake of its own, the same TLS.
    let resp = client.send_request(h2_request("POST", port, "/echo", full("again"))).await;
    resp.unwrap().into_body().collect().await.unwrap();
    let events = h.flow_events();
    let (connect, tls, version) = find!(events,
        ProxyEvent::UpstreamConnection { elapsed_connect_ms, elapsed_tls_ms, tls_version, .. } =>
            (*elapsed_connect_ms, *elapsed_tls_ms, tls_version.clone()));
    assert_eq!((connect, tls, version.as_deref()), (None, None, Some("TLSv1.3")));
    let (sent_at, end_at) = (
        find!(events, ProxyEvent::RequestBodyComplete { elapsed_ms, .. } => *elapsed_ms),
        find!(events, ProxyEvent::ResponseBodyComplete { elapsed_ms, .. } => *elapsed_ms),
    );
    assert!(sent_at <= end_at, "{sent_at} {end_at}");
}

#[tokio::test(flavor = "multi_thread")]
async fn h2_client_to_an_h1_upstream() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h1_only(&h.pki.server))).await;
    let port = upstream.port();
    let mut client = h.h2_client(port).await;

    let resp = client.send_request(h2_request("POST", port, "/echo", full("name=yaak"))).await;
    let resp = resp.unwrap();
    assert_eq!((resp.status(), resp.version()), (StatusCode::OK, Version::HTTP_2));
    assert_eq!(resp.into_body().collect().await.unwrap().to_bytes(), "name=yaak");
    let events = h.flow_events();
    let version = find!(events, ProxyEvent::RequestStart { http_version, .. } => http_version);
    assert_eq!(version, "HTTP/2");
    let (version, remote_addr) = find!(events,
        ProxyEvent::ResponseStart { http_version, remote_addr, .. } =>
            (http_version.clone(), *remote_addr));
    assert_eq!((version.as_str(), remote_addr), ("HTTP/1.1", Some(upstream)));
    assert_eq!(body(&events, true), (b"name=yaak".to_vec(), 9));

    // `:authority` goes upstream as `Host`.
    let resp = client.send_request(h2_request("GET", port, "/authority", full(""))).await;
    let text = resp.unwrap().into_body().collect().await.unwrap().to_bytes();
    assert_eq!(text, format!("authority=none host=localhost:{port}"));
    h.flow_events();

    // Headers for the HTTP/1.1 connection alone are captured but not sent on to the client.
    let resp = client.send_request(h2_request("GET", port, "/hop", full(""))).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    for name in ["connection", "x-hop", "keep-alive"] {
        assert!(!resp.headers().contains_key(name), "{name} in {:?}", resp.headers());
    }
    assert_eq!(resp.into_body().collect().await.unwrap().to_bytes(), "hop");
    let captured = headers(&h.flow_events(), false);
    assert!(captured.contains(&("x-hop".to_string(), "1".to_string())), "{captured:?}");
}

/// Each stream is a flow of its own, all on the client's one connection, and they share one
/// connection upstream when the server speaks HTTP/2.
#[tokio::test(flavor = "multi_thread")]
async fn concurrent_h2_streams_are_flows_of_their_own() {
    let h = Harness::start(1024);
    let accepts = Arc::new(AtomicUsize::new(0));
    let upstream = spawn_upstream_with(Some(h.pki.server.clone()), accepts.clone(), route).await;
    let port = upstream.port();
    let client = h.h2_client(port).await;

    const STREAMS: usize = 20;
    let sent = (0..STREAMS).map(|i| {
        let mut client = client.clone();
        async move {
            let req = h2_request("POST", port, "/echo", full(format!("stream {i}")));
            let resp = client.send_request(req).await.unwrap();
            resp.into_body().collect().await.unwrap().to_bytes()
        }
    });
    let bodies = futures_util::future::join_all(sent).await;
    for (i, body) in bodies.iter().enumerate() {
        assert_eq!(body, format!("stream {i}").as_bytes());
    }

    let flows = h.flows_events(STREAMS);
    assert_eq!(flows.len(), STREAMS);
    let connections: HashSet<u64> = flows
        .values()
        .map(|events| find!(events, ProxyEvent::RequestStart { connection, .. } => *connection))
        .collect();
    assert_eq!(connections.len(), 1, "one client connection");
    let mut captured: Vec<String> =
        flows.values().map(|events| String::from_utf8(body(events, true).0).unwrap()).collect();
    captured.sort();
    let mut expected: Vec<String> = (0..STREAMS).map(|i| format!("stream {i}")).collect();
    expected.sort();
    assert_eq!(captured, expected);
    for events in flows.values() {
        let echoed = body(events, false).0;
        assert_eq!(echoed, body(events, true).0, "each flow keeps its own response");
    }
    assert_eq!(accepts.load(Ordering::SeqCst), 1, "the streams share one upstream connection");
}

/// An HTTP/1.1 server takes the streams on connections of its own, at once rather than one
/// after another, and they are reused after.
#[tokio::test(flavor = "multi_thread")]
async fn concurrent_h2_streams_to_an_h1_upstream_run_at_once() {
    const STREAMS: usize = 10;
    let h = Harness::start(1024);
    let accepts = Arc::new(AtomicUsize::new(0));
    // Each `/together` request is held until all of them are in flight at once, which they can
    // only be if none waits for another. Counted, not timed: how long a connection takes to
    // open varies by machine.
    let in_flight = Arc::new(AtomicUsize::new(0));
    let most = Arc::new(AtomicUsize::new(0));
    let handler = {
        let (in_flight, most) = (in_flight.clone(), most.clone());
        move |req: Request<Incoming>| {
            let (in_flight, most) = (in_flight.clone(), most.clone());
            async move {
                if req.uri().path() != "/together" {
                    return route(req).await;
                }
                most.fetch_max(in_flight.fetch_add(1, Ordering::SeqCst) + 1, Ordering::SeqCst);
                let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
                while in_flight.load(Ordering::SeqCst) < STREAMS
                    && tokio::time::Instant::now() < deadline
                {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                Ok(Response::new(full("together")))
            }
        }
    };
    let upstream =
        spawn_upstream_with(Some(h1_only(&h.pki.server)), accepts.clone(), handler).await;
    let port = upstream.port();
    let client = h.h2_client(port).await;

    let sent = (0..STREAMS).map(|_| {
        let mut client = client.clone();
        async move {
            let resp = client.send_request(h2_request("GET", port, "/together", full(""))).await;
            resp.unwrap().into_body().collect().await.unwrap().to_bytes()
        }
    });
    for body in futures_util::future::join_all(sent).await {
        assert_eq!(body, "together");
    }
    assert_eq!(most.load(Ordering::SeqCst), STREAMS, "streams in flight upstream at once");
    assert_eq!(h.flows_events(STREAMS).len(), STREAMS);
    let opened = accepts.load(Ordering::SeqCst);
    assert!((2..=STREAMS).contains(&opened), "{opened} upstream connections");

    let mut client = client.clone();
    let resp = client.send_request(h2_request("GET", port, "/hello", full(""))).await.unwrap();
    assert_eq!(resp.into_body().collect().await.unwrap().to_bytes(), "hello");
    h.flow_events();
    assert_eq!(accepts.load(Ordering::SeqCst), opened, "an idle connection is reused");
}

/// Sends its message when dropped, so a test sees the server give up on a request.
struct OnDrop(tokio::sync::mpsc::UnboundedSender<&'static str>, &'static str);

impl Drop for OnDrop {
    fn drop(&mut self) {
        let _ = self.0.send(self.1);
    }
}

/// An upstream whose `/hang` never answers and whose `/stall` sends "hello" and then nothing,
/// reporting on `tx` when each request arrives and when it is dropped.
async fn spawn_stalling_upstream(
    tls: Arc<ServerConfig>,
    tx: tokio::sync::mpsc::UnboundedSender<&'static str>,
) -> SocketAddr {
    let handler = move |req: Request<Incoming>| {
        let tx = tx.clone();
        async move {
            match req.uri().path() {
                "/hang" => {
                    let _guard = OnDrop(tx.clone(), "hang dropped");
                    let _ = tx.send("hang arrived");
                    match std::future::pending::<Infallible>().await {}
                }
                _ => {
                    let guard = OnDrop(tx, "stall dropped");
                    // The second frame never comes, and the guard goes with the body.
                    let frames =
                        futures_util::stream::unfold((true, guard), |(first, guard)| async move {
                            if first {
                                let _ = guard.0.send("stall sent");
                                let hello = Ok(Frame::data(Bytes::from("hello")));
                                return Some((hello, (false, guard)));
                            }
                            let _guard = guard;
                            std::future::pending().await
                        });
                    Ok(Response::new(BodyExt::boxed(StreamBody::new(frames))))
                }
            }
        }
    };
    spawn_upstream_with(Some(tls), Arc::new(AtomicUsize::new(0)), handler).await
}

async fn next_message(rx: &mut tokio::sync::mpsc::UnboundedReceiver<&'static str>) -> &'static str {
    tokio::time::timeout(Duration::from_secs(10), rx.recv()).await.unwrap().unwrap()
}

/// A stream the client resets before the response is a cancelled flow, not an error, and the
/// request upstream is cancelled with it.
#[tokio::test(flavor = "multi_thread")]
async fn h2_stream_cancelled_before_the_response() {
    let h = Harness::start(1024);
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let upstream = spawn_stalling_upstream(h.pki.server.clone(), tx).await;
    let port = upstream.port();
    let mut client = h.h2_client(port).await;

    let pending = tokio::spawn({
        let mut client = client.clone();
        async move { client.send_request(h2_request("GET", port, "/hang", full(""))).await }
    });
    assert_eq!(next_message(&mut rx).await, "hang arrived");
    pending.abort();
    assert_eq!(next_message(&mut rx).await, "hang dropped");

    let events = h.flow_events();
    find!(events, ProxyEvent::Cancelled { .. } => ());
    assert!(!events.iter().any(|e| matches!(e, ProxyEvent::Error { .. })), "{events:#?}");

    // The connection carries on.
    let resp = client.send_request(h2_request("GET", port, "/stall", full(""))).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(next_message(&mut rx).await, "stall sent");
}

/// A stream the client resets partway through the response body is cancelled too.
#[tokio::test(flavor = "multi_thread")]
async fn h2_stream_cancelled_during_the_body() {
    let h = Harness::start(1024);
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let upstream = spawn_stalling_upstream(h.pki.server.clone(), tx).await;
    let port = upstream.port();
    let mut client = h.h2_client(port).await;

    let resp = client.send_request(h2_request("GET", port, "/stall", full(""))).await.unwrap();
    let mut body = resp.into_body();
    let hello = body.frame().await.unwrap().unwrap().into_data().unwrap();
    assert_eq!(hello, "hello");
    assert_eq!(next_message(&mut rx).await, "stall sent");
    drop(body);
    assert_eq!(next_message(&mut rx).await, "stall dropped");

    let events = h.flow_events();
    let (size, error, cancelled) = find!(events,
        ProxyEvent::ResponseBodyComplete { size, error, cancelled, .. } =>
            (*size, error.clone(), *cancelled));
    assert_eq!((size, error, cancelled), (5, None, true));
}

/// Trailers go both ways, as gRPC needs them to.
#[tokio::test(flavor = "multi_thread")]
async fn h2_trailers_pass_through() {
    let h = Harness::start(1024);
    for tls in [h.pki.server.clone(), h1_only(&h.pki.server)] {
        let upstream = spawn_upstream(Some(tls)).await;
        let port = upstream.port();
        let mut client = h.h2_client(port).await;

        let mut trailers = hyper::HeaderMap::new();
        trailers.insert("x-client-trailer", HeaderValue::from_static("1"));
        let frames = [
            Ok(Frame::data(Bytes::from("message"))),
            Ok(Frame::trailers(trailers)),
        ];
        let upload = BodyExt::boxed(StreamBody::new(futures_util::stream::iter(frames)));
        let mut req = h2_request("POST", port, "/trailers", upload);
        req.headers_mut().insert("te", HeaderValue::from_static("trailers"));
        // HTTP/1.1 carries only trailers named up front, so an HTTP/1.1 server gets this one.
        req.headers_mut().insert("trailer", HeaderValue::from_static("x-client-trailer"));

        let resp = client.send_request(req).await.unwrap();
        let collected = resp.into_body().collect().await.unwrap();
        let trailers = collected.trailers().cloned().unwrap();
        assert_eq!(trailers["x-client-trailer"], "1");
        assert_eq!(trailers["x-upstream-trailer"], "yes");
        assert_eq!(collected.to_bytes(), "message");

        let events = h.flow_events();
        let (size, error) = find!(events,
            ProxyEvent::ResponseBodyComplete { size, error, .. } => (*size, error.clone()));
        assert_eq!((size, error), (7, None));
        assert_eq!(body(&events, true), (b"message".to_vec(), 7));
    }
}

/// HTTP/2 may send a field per cookie; an HTTP/1.1 server gets them as the one `Cookie` it
/// expects.
#[tokio::test(flavor = "multi_thread")]
async fn h2_cookies_are_joined_for_an_h1_upstream() {
    let h = Harness::start(1024);
    for (tls, expected) in [
        (h1_only(&h.pki.server), "theme=dark; session=abc"),
        (h.pki.server.clone(), "theme=dark | session=abc"),
    ] {
        let upstream = spawn_upstream(Some(tls)).await;
        let port = upstream.port();
        let mut client = h.h2_client(port).await;
        let mut req = h2_request("GET", port, "/cookies", full(""));
        req.headers_mut().append("cookie", HeaderValue::from_static("theme=dark"));
        req.headers_mut().append("cookie", HeaderValue::from_static("session=abc"));
        let resp = client.send_request(req).await.unwrap();
        assert_eq!(resp.into_body().collect().await.unwrap().to_bytes(), expected);
        h.flow_events();
    }
}

/// A client that resets its stream partway through an upload cancels the flow, whichever
/// version the server speaks.
#[tokio::test(flavor = "multi_thread")]
async fn h2_upload_cancelled_by_the_client() {
    let h = Harness::start(1024);
    for tls in [h1_only(&h.pki.server), h.pki.server.clone()] {
        let upstream = spawn_upstream(Some(tls)).await;
        let port = upstream.port();
        let client = h.h2_client(port).await;

        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Result<Frame<Bytes>, Infallible>>();
        tx.send(Ok(Frame::data(Bytes::from("first part")))).unwrap();
        let frames = futures_util::stream::unfold(rx, |mut rx| async move {
            rx.recv().await.map(|frame| (frame, rx))
        });
        let upload = BodyExt::boxed(StreamBody::new(frames));
        let pending = tokio::spawn({
            let mut client = client.clone();
            async move { client.send_request(h2_request("POST", port, "/echo", upload)).await }
        });
        tokio::time::sleep(Duration::from_millis(300)).await;
        pending.abort();
        drop(tx);

        let events = h.flow_events();
        find!(events, ProxyEvent::Cancelled { .. } => ());
        assert!(!events.iter().any(|e| matches!(e, ProxyEvent::Error { .. })), "{events:#?}");
    }
}

/// An HTTP/2 request's body has no length of its own, which HTTP/1.1 needs, even on a GET.
#[tokio::test(flavor = "multi_thread")]
async fn h2_streamed_body_reaches_an_h1_upstream() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h1_only(&h.pki.server))).await;
    let port = upstream.port();
    let mut client = h.h2_client(port).await;

    for method in ["GET", "POST"] {
        let frames = ["streamed ", "body"].map(|s| Ok(Frame::data(Bytes::from(s))));
        let upload = BodyExt::boxed(StreamBody::new(futures_util::stream::iter(frames)));
        let resp = client.send_request(h2_request(method, port, "/echo", upload)).await.unwrap();
        assert_eq!(resp.into_body().collect().await.unwrap().to_bytes(), "streamed body");
        let events = h.flow_events();
        assert_eq!(body(&events, true), (b"streamed body".to_vec(), 13), "{method}");
    }
}

/// More than the flow-control windows hold, both ways, through an HTTP/2 and an HTTP/1.1 server.
#[tokio::test(flavor = "multi_thread")]
async fn h2_large_bodies_pass_flow_control() {
    const LARGE: usize = 12 * 1024 * 1024;
    let h = Harness::start(1024);
    for tls in [h.pki.server.clone(), h1_only(&h.pki.server)] {
        let upstream = spawn_upstream(Some(tls)).await;
        let port = upstream.port();
        let mut client = h.h2_client(port).await;

        let chunk = Bytes::from(vec![b'y'; BIG_BODY]);
        let chunks = (0..LARGE / BIG_BODY).map(move |_| Ok(Frame::data(chunk.clone())));
        let upload = BodyExt::boxed(StreamBody::new(futures_util::stream::iter(chunks)));
        let resp = client.send_request(h2_request("POST", port, "/echo", upload)).await.unwrap();
        let echoed = resp.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(echoed.len(), LARGE);
        assert!(echoed.iter().all(|b| *b == b'y'));

        let events = h.flow_events();
        let (size, truncated) = find!(events,
            ProxyEvent::RequestBodyComplete { size, truncated, .. } => (*size, *truncated));
        assert_eq!((size, truncated), (LARGE as u64, true));
        let (size, truncated, error) = find!(events,
            ProxyEvent::ResponseBodyComplete { size, truncated, error, .. } =>
                (*size, *truncated, error.clone()));
        assert_eq!((size, truncated, error), (LARGE as u64, true, None));
        assert_eq!(body(&events, false), (vec![b'y'; 1024], LARGE));
    }
}

/// A flow ends when its response does, not when a connection closes: the upstream answers at
/// once and keeps its connection open, as does the client, and the flow's time is the answer's.
#[tokio::test(flavor = "multi_thread")]
async fn keep_alive_connections_do_not_lengthen_flows() {
    let h = Harness::start(1024);
    let upstreams = [
        ("plain HTTP/1.1", spawn_upstream(None).await, false),
        ("HTTP/1.1", spawn_upstream(Some(h1_only(&h.pki.server))).await, true),
        ("HTTP/2", spawn_upstream(Some(h.pki.server.clone())).await, true),
    ];
    // Every connection stays open to the end of the test, each reused across requests.
    let h1_client = h.client();
    let mut h2_clients = Vec::new();

    for (upstream_name, upstream, tls) in upstreams {
        let port = upstream.port();
        let mut h2_client = if tls { Some(h.h2_client(port).await) } else { None };
        for path in ["/empty", "/empty-stream", "/hello"] {
            for client_version in ["HTTP/1.1", "HTTP/2"] {
                let case = format!("{client_version} client, {upstream_name} upstream, {path}");
                let scheme = if tls { "https" } else { "http" };
                let url = format!("{scheme}://localhost:{port}{path}");
                let body = match (client_version, &mut h2_client) {
                    ("HTTP/1.1", _) => {
                        let resp = h1_client.post(&url).body("x=1").send().await.unwrap();
                        resp.bytes().await.unwrap()
                    }
                    (_, Some(client)) => {
                        let req = h2_request("POST", port, path, full("x=1"));
                        let resp = client.send_request(req).await.unwrap();
                        resp.into_body().collect().await.unwrap().to_bytes()
                    }
                    // HTTP/2 needs TLS here.
                    (_, None) => continue,
                };
                assert_eq!(body, if path == "/hello" { "hello" } else { "" }, "{case}");

                let events = h.flow_events();
                let version =
                    find!(events, ProxyEvent::RequestStart { http_version, .. } => http_version);
                assert_eq!(version, client_version, "{case}");
                let headers_ms =
                    find!(events, ProxyEvent::ResponseStart { elapsed_ms, .. } => *elapsed_ms);
                let (end_ms, error, cancelled) = find!(events,
                    ProxyEvent::ResponseBodyComplete { elapsed_ms, error, cancelled, .. } =>
                        (*elapsed_ms, error.clone(), *cancelled));
                assert_eq!((error, cancelled), (None, false), "{case}");
                // Generous for a slow CI runner; a flow held to the connection's close would
                // not end at all while every connection here stays open.
                assert!(end_ms - headers_ms < 2_000, "{case}: headers {headers_ms}, end {end_ms}");
                assert!(end_ms < 5_000, "{case}: took {end_ms} ms");
            }
        }
        h2_clients.extend(h2_client);
    }
    drop((h1_client, h2_clients));
}

/// With HTTP/2 off, a client that offers both gets HTTP/1.1, from the next connection on.
#[tokio::test(flavor = "multi_thread")]
async fn http1_only_makes_h2_clients_fall_back() {
    let h = Harness::start(1024);
    let upstream = spawn_upstream(Some(h.pki.server.clone())).await;
    let port = upstream.port();

    h.proxy.set_http2(false);
    let tls = h.tls_tunnel(port, &[b"h2", b"http/1.1"]).await;
    assert_eq!(tls.get_ref().1.alpn_protocol(), Some(&b"http/1.1"[..]));
    let (mut sender, conn) =
        hyper::client::conn::http1::handshake(TokioIo::new(tls)).await.unwrap();
    tokio::spawn(conn);
    let req = Request::get("/hello").header(HOST, format!("localhost:{port}")).body(full(""));
    let resp = sender.send_request(req.unwrap()).await.unwrap();
    assert_eq!(resp.into_body().collect().await.unwrap().to_bytes(), "hello");
    let events = h.flow_events();
    let version = find!(events, ProxyEvent::RequestStart { http_version, .. } => http_version);
    assert_eq!(version, "HTTP/1.1");

    h.proxy.set_http2(true);
    let mut client = h.h2_client(port).await;
    let resp = client.send_request(h2_request("GET", port, "/hello", full(""))).await.unwrap();
    assert_eq!(resp.version(), Version::HTTP_2);
    let events = h.flow_events();
    let version = find!(events, ProxyEvent::RequestStart { http_version, .. } => http_version);
    assert_eq!(version, "HTTP/2");
}
