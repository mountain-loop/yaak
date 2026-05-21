use std::convert::Infallible;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::sync::mpsc as std_mpsc;
use std::time::Instant;

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::header::HeaderMap;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode, Uri};
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use hyper_util::server::conn::auto;
use rustls::ClientConfig;
use rustls::pki_types::ServerName;
use tokio::net::TcpStream;
use tokio_rustls::TlsAcceptor;

use crate::body::MeasuredBody;
use crate::cert::CertificateAuthority;
use crate::{ProxyEvent, REQUEST_ID};

type BoxBody = http_body_util::combinators::BoxBody<Bytes, hyper::Error>;

fn full_body(bytes: Bytes) -> BoxBody {
    Full::new(bytes).map_err(|never| match never {}).boxed()
}

fn measured_incoming(
    incoming: Incoming,
    id: u64,
    start: Instant,
    tx: std_mpsc::Sender<ProxyEvent>,
) -> BoxBody {
    MeasuredBody::new(incoming, id, start, tx).boxed()
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

fn emit_request_events(
    tx: &std_mpsc::Sender<ProxyEvent>,
    id: u64,
    headers: &HeaderMap,
    body: &Option<Vec<u8>>,
) {
    for (name, value) in headers.iter() {
        let _ = tx.send(ProxyEvent::RequestHeader {
            id,
            name: name.to_string(),
            value: value.to_str().unwrap_or("<binary>").to_string(),
        });
    }
    if let Some(body) = body {
        let _ = tx.send(ProxyEvent::RequestBody { id, body: body.clone() });
    }
}

fn emit_response_events(
    tx: &std_mpsc::Sender<ProxyEvent>,
    id: u64,
    resp: &Response<Incoming>,
    start: &Instant,
) {
    let _ = tx.send(ProxyEvent::ResponseStart {
        id,
        status: resp.status().as_u16(),
        http_version: version_str(resp.version()),
        elapsed_ms: start.elapsed().as_millis() as u64,
    });
    for (name, value) in resp.headers().iter() {
        let _ = tx.send(ProxyEvent::ResponseHeader {
            id,
            name: name.to_string(),
            value: value.to_str().unwrap_or("<binary>").to_string(),
        });
    }
}

pub(crate) async fn handle_request(
    req: Request<Incoming>,
    event_tx: std_mpsc::Sender<ProxyEvent>,
    ca: Arc<CertificateAuthority>,
) -> Result<Response<BoxBody>, Infallible> {
    let result = if req.method() == Method::CONNECT {
        handle_connect(req, event_tx, ca).await
    } else {
        handle_http(req, event_tx).await
    };
    match result {
        Ok(resp) => Ok(resp),
        Err(e) => {
            eprintln!("Proxy error: {e}");
            Ok(Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(full_body(Bytes::from(format!("Proxy error: {e}"))))
                .unwrap())
        }
    }
}

async fn handle_http(
    req: Request<Incoming>,
    event_tx: std_mpsc::Sender<ProxyEvent>,
) -> Result<Response<BoxBody>, Box<dyn std::error::Error + Send + Sync>> {
    let id = REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let method = req.method().to_string();
    let uri = req.uri().to_string();
    let http_version = version_str(req.version());
    let start = Instant::now();

    let _ = event_tx.send(ProxyEvent::RequestStart { id, method, url: uri.clone(), http_version });

    let client: Client<_, Full<Bytes>> = Client::builder(TokioExecutor::new()).build_http();

    let (parts, body) = req.into_parts();
    let body_bytes = body.collect().await?.to_bytes();
    let request_body = if body_bytes.is_empty() { None } else { Some(body_bytes.to_vec()) };
    emit_request_events(&event_tx, id, &parts.headers, &request_body);

    let outgoing_req = Request::from_parts(parts, Full::new(body_bytes));

    match client.request(outgoing_req).await {
        Ok(resp) => {
            emit_response_events(&event_tx, id, &resp, &start);

            let (parts, body) = resp.into_parts();
            Ok(Response::from_parts(parts, measured_incoming(body, id, start, event_tx)))
        }
        Err(e) => {
            let _ = event_tx.send(ProxyEvent::Error { id, error: e.to_string() });
            Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        }
    }
}

async fn handle_connect(
    req: Request<Incoming>,
    event_tx: std_mpsc::Sender<ProxyEvent>,
    ca: Arc<CertificateAuthority>,
) -> Result<Response<BoxBody>, Box<dyn std::error::Error + Send + Sync>> {
    let authority = req.uri().authority().map(|a| a.to_string()).unwrap_or_default();
    let (host, port) = parse_host_port(&authority);

    let server_config = ca.server_config(&host)?;
    let acceptor = TlsAcceptor::from(server_config);

    let target_addr = format!("{host}:{port}");

    tokio::spawn(async move {
        let upgraded = match hyper::upgrade::on(req).await {
            Ok(u) => u,
            Err(e) => {
                eprintln!("CONNECT upgrade failed: {e}");
                return;
            }
        };

        let tls_stream = match acceptor.accept(hyper_util::rt::TokioIo::new(upgraded)).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("TLS accept failed for {host}: {e}");
                return;
            }
        };

        let tx = event_tx.clone();
        let host_for_requests = host.clone();
        let mut builder = auto::Builder::new(TokioExecutor::new());
        builder.http1().preserve_header_case(true).title_case_headers(true);
        if let Err(e) = builder
            .serve_connection_with_upgrades(
                hyper_util::rt::TokioIo::new(tls_stream),
                service_fn(move |req| {
                    let tx = tx.clone();
                    let host = host_for_requests.clone();
                    let target_addr = target_addr.clone();
                    async move { handle_tunneled_request(req, tx, &host, &target_addr).await }
                }),
            )
            .await
        {
            eprintln!("MITM connection error for {host}: {e}");
        }
    });

    Ok(Response::new(full_body(Bytes::new())))
}

async fn handle_tunneled_request(
    req: Request<Incoming>,
    event_tx: std_mpsc::Sender<ProxyEvent>,
    host: &str,
    target_addr: &str,
) -> Result<Response<BoxBody>, Infallible> {
    let result = forward_https(req, event_tx, host, target_addr).await;
    match result {
        Ok(resp) => Ok(resp),
        Err(e) => {
            eprintln!("HTTPS forward error: {e:?}");
            Ok(Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(full_body(Bytes::from(format!("Proxy error: {e}"))))
                .unwrap())
        }
    }
}

enum HttpSender {
    H1(hyper::client::conn::http1::SendRequest<Full<Bytes>>),
    H2(hyper::client::conn::http2::SendRequest<Full<Bytes>>),
}

impl HttpSender {
    async fn send_request(
        &mut self,
        req: Request<Full<Bytes>>,
    ) -> Result<Response<Incoming>, hyper::Error> {
        match self {
            HttpSender::H1(s) => s.send_request(req).await,
            HttpSender::H2(s) => s.send_request(req).await,
        }
    }
}

async fn forward_https(
    req: Request<Incoming>,
    event_tx: std_mpsc::Sender<ProxyEvent>,
    host: &str,
    target_addr: &str,
) -> Result<Response<BoxBody>, Box<dyn std::error::Error + Send + Sync>> {
    let id = REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let method = req.method().to_string();
    let http_version = version_str(req.version());
    let path = req.uri().path_and_query().map(|pq| pq.to_string()).unwrap_or_else(|| "/".into());
    let uri_str = format!("https://{host}{path}");
    let start = Instant::now();

    let _ =
        event_tx.send(ProxyEvent::RequestStart { id, method, url: uri_str.clone(), http_version });

    // Connect to upstream with TLS
    let tcp_stream = TcpStream::connect(target_addr).await?;

    let mut root_store = rustls::RootCertStore::empty();
    for cert in rustls_native_certs::load_native_certs().certs {
        let _ = root_store.add(cert);
    }

    let mut tls_config =
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()?
            .with_root_certificates(root_store)
            .with_no_client_auth();
    tls_config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

    let connector = tokio_rustls::TlsConnector::from(Arc::new(tls_config));
    let server_name = ServerName::try_from(host.to_string())?;
    let tls_stream = connector.connect(server_name, tcp_stream).await?;

    let negotiated_h2 = tls_stream.get_ref().1.alpn_protocol().map_or(false, |p| p == b"h2");

    let io = hyper_util::rt::TokioIo::new(tls_stream);

    let mut sender = if negotiated_h2 {
        let (sender, conn) =
            hyper::client::conn::http2::Builder::new(TokioExecutor::new()).handshake(io).await?;
        tokio::spawn(async move {
            if let Err(e) = conn.await {
                eprintln!("Upstream h2 connection error: {e}");
            }
        });
        HttpSender::H2(sender)
    } else {
        let (sender, conn) = hyper::client::conn::http1::Builder::new()
            .preserve_header_case(true)
            .title_case_headers(true)
            .handshake(io)
            .await?;
        tokio::spawn(async move {
            if let Err(e) = conn.await {
                eprintln!("Upstream h1 connection error: {e}");
            }
        });
        HttpSender::H1(sender)
    };

    // Capture request metadata
    let (mut parts, body) = req.into_parts();
    let body_bytes = body.collect().await?.to_bytes();
    let request_body = if body_bytes.is_empty() { None } else { Some(body_bytes.to_vec()) };
    emit_request_events(&event_tx, id, &parts.headers, &request_body);

    if negotiated_h2 {
        // HTTP/2 requires absolute-form URI with scheme + authority
        parts.uri = uri_str.parse::<Uri>()?;
    } else {
        parts.uri = path.parse::<Uri>()?;
    }

    if !parts.headers.contains_key(hyper::header::HOST) {
        parts.headers.insert(hyper::header::HOST, host.parse()?);
    }

    let outgoing = Request::from_parts(parts, Full::new(body_bytes));

    match sender.send_request(outgoing).await {
        Ok(resp) => {
            emit_response_events(&event_tx, id, &resp, &start);

            let (parts, body) = resp.into_parts();
            Ok(Response::from_parts(parts, measured_incoming(body, id, start, event_tx)))
        }
        Err(e) => {
            let _ = event_tx.send(ProxyEvent::Error { id, error: e.to_string() });
            Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
        }
    }
}

fn parse_host_port(authority: &str) -> (String, u16) {
    if let Some((host, port_str)) = authority.rsplit_once(':') {
        if let Ok(port) = port_str.parse::<u16>() {
            return (host.to_string(), port);
        }
    }
    (authority.to_string(), 443)
}
