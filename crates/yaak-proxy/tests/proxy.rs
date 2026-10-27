use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::mpsc::Receiver;
use std::time::{Duration, SystemTime};

use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{CONNECTION, CONTENT_LENGTH, CONTENT_TYPE, HOST, UPGRADE};
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
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
use yaak_proxy::{CaStore, ProxyConfig, ProxyEvent, ProxyHandle, start_proxy};

const BIG_BODY: usize = 64 * 1024;

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
        "/echo" => Response::new(full(req.into_body().collect().await.unwrap().to_bytes())),
        "/authority" => Response::new(full(format!(
            "authority={} host={}",
            req.uri().authority().map_or("none".into(), |a| a.to_string()),
            req.headers().get(HOST).map_or("none", |h| h.to_str().unwrap()),
        ))),
        "/big" => Response::new(full(vec![b'x'; BIG_BODY])),
        "/late-end" => late_end(5),
        // The stream ends with half the promised bytes, so the upstream resets it mid-body.
        "/cut" => late_end(10),
        "/ws" => websocket_echo(req),
        _ => Response::builder().status(StatusCode::NOT_FOUND).body(full("not found")).unwrap(),
    })
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
            if msg.is_text() {
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
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            let tls = tls.clone();
            tokio::spawn(async move {
                let builder = auto::Builder::new(TokioExecutor::new());
                let svc = service_fn(route);
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
        let mut proxy = start_proxy(config).unwrap();
        let events = proxy.take_event_rx().unwrap();
        Self { proxy, events, ca, pki, _dir: dir }
    }

    fn proxy_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.proxy.port)
    }

    fn client_trusting(&self, root_pem: &str) -> reqwest::Client {
        reqwest::Client::builder()
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
            let done =
                matches!(event, ProxyEvent::ResponseBodyComplete { .. } | ProxyEvent::Error { .. });
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
    let (method, req_url, req_version, started_at) = find!(events,
        ProxyEvent::RequestStart { method, url, http_version, started_at, .. } =>
            (method.clone(), url.clone(), http_version.clone(), *started_at));
    assert_eq!(method, "GET");
    assert_eq!(req_url, url);
    assert_eq!(req_version, "HTTP/1.1");
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
    for text in ["ping", "pong"] {
        ws.send(Message::text(text)).await.unwrap();
        let reply = ws.next().await.unwrap().unwrap();
        assert_eq!(reply.into_text().unwrap().as_str(), text);
    }
    ws.close(None).await.unwrap();

    let events = h.flow_events();
    let req_url = find!(events, ProxyEvent::RequestStart { url, .. } => url.clone());
    assert_eq!(req_url, format!("https://localhost:{port}/ws"));
    let (status, version) = find!(events,
        ProxyEvent::ResponseStart { status, http_version, .. } => (*status, http_version.clone()));
    assert_eq!((status, version.as_str()), (101, "HTTP/1.1"));
    let (size, error) = find!(events, ProxyEvent::ResponseBodyComplete { size, error, .. } => (*size, error.clone()));
    assert_eq!((size, error), (0, None));
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
    assert!(h.events.try_recv().is_err(), "passthrough traffic must not produce flows");
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
    tokio::time::sleep(Duration::from_millis(100)).await;
    pinned
        .connect(name, h.connect_tunnel(port).await)
        .await
        .expect("one certificate alert should be enough to pass the host through");
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

/// A request whose connection upstream is routed back into the proxy, as happened to Telegram's
/// while the system proxy was on, arrives again with a bare path. Sending that on would loop
/// forever.
#[tokio::test(flavor = "multi_thread")]
async fn plain_http_request_looped_back_to_the_proxy_stops() {
    let h = Harness::start(1024);
    let url = format!("http://127.0.0.1:{}/api", h.proxy.port);

    let resp = h.client().post(&url).body(vec![0xefu8; 44]).send().await.unwrap();
    assert_eq!(resp.status(), 508);
    assert_eq!(resp.text().await.unwrap(), "request looped back to Yaak Proxy");

    let events = h.flow_events();
    let error = find!(events, ProxyEvent::Error { error, .. } => error.clone());
    assert_eq!(error, "request looped back to Yaak Proxy");
}
