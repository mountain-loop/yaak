use std::convert::Infallible;
use std::io::Write;
use std::net::SocketAddr;
use std::time::{Duration, Instant};

use bytes::Bytes;
use flate2::Compression;
use flate2::write::GzEncoder;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use yaak_proxy_lib::ProxyCtx;
use yaak_proxy_lib::bodies::{read_body, read_raw_body};
use yaak_proxy_lib::models::{Flow, FlowBody};
use yaak_proxy_lib::settings::ProxySettings;
use yaak_rpc::RpcEventEmitter;

const CAPTURE_LIMIT: usize = 1024;
const BIG_BODY: usize = 4096;

fn gzip(data: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data).unwrap();
    encoder.finish().unwrap()
}

async fn route(req: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
    Ok(match req.uri().path() {
        "/echo" => {
            let body = req.into_body().collect().await.unwrap().to_bytes();
            Response::builder()
                .header("content-type", "text/plain")
                .header("content-encoding", "gzip")
                .body(Full::from(gzip(&body)))
                .unwrap()
        }
        // Answers at once and drains the upload afterwards, so the response ends first.
        "/early" => {
            let mut body = req.into_body();
            tokio::spawn(async move {
                while let Some(Ok(_)) = body.frame().await {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            });
            Response::new(Full::from("ok"))
        }
        _ => Response::new(Full::from(vec![b'x'; BIG_BODY])),
    })
}

async fn spawn_upstream() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            tokio::spawn(http1::Builder::new().serve_connection(TokioIo::new(tcp), service_fn(route)));
        }
    });
    addr
}

/// Waits for the event loop to write the flow for `url`.
async fn wait_for_flow(ctx: &ProxyCtx, url: &str) -> Flow {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let flows = ctx.db.with_conn(|db| db.find_all::<Flow>().unwrap());
        if let Some(flow) = flows.into_iter().find(|f| f.url == url) {
            return flow;
        }
        assert!(Instant::now() < deadline, "no flow for {url}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn flow_is_stored_with_its_bodies() {
    let dir = tempfile::tempdir().unwrap();
    let settings =
        ProxySettings { port: 0, capture_body_limit: CAPTURE_LIMIT, ..Default::default() };
    settings.save(&dir.path().join("settings.json")).unwrap();

    let (events, _event_rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir.path(), events).unwrap();
    ctx.start().unwrap();
    let port = ctx.port().unwrap();
    assert!(dir.path().join("ca/ca.pem").exists());
    assert!(dir.path().join("blobs.sqlite").exists());

    let upstream = spawn_upstream().await;
    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}")).unwrap())
        .build()
        .unwrap();

    let echo_url = format!("http://{upstream}/echo");
    let resp = client.post(&echo_url).body("hello proxy").send().await.unwrap();
    assert_eq!(resp.status(), 200);
    resp.bytes().await.unwrap();

    let flow = wait_for_flow(&ctx, &echo_url).await;
    let compressed = gzip(b"hello proxy");
    assert!(flow.id.starts_with("fl_"), "{}", flow.id);
    assert_eq!(flow.method, "POST");
    assert_eq!(flow.status, Some(200));
    assert_eq!(flow.client_http_version, "HTTP/1.1");
    assert_eq!(flow.upstream_http_version.as_deref(), Some("HTTP/1.1"));
    assert_eq!(flow.remote_addr, Some(upstream.to_string()));
    assert_eq!(flow.content_type.as_deref(), Some("text/plain"));
    assert_eq!(flow.request_size, 11);
    assert_eq!(flow.response_size, compressed.len() as i64);
    assert!(!flow.request_truncated && !flow.response_truncated);
    assert!(flow.elapsed_headers_ms.is_some() && flow.elapsed_ms >= flow.elapsed_headers_ms);
    assert!(flow.request_headers.iter().any(|h| h.name == "content-length"));
    assert_eq!(flow.error, None);

    assert_eq!(read_raw_body(&ctx.blobs, &flow.id, FlowBody::Request).unwrap(), b"hello proxy");
    assert_eq!(read_raw_body(&ctx.blobs, &flow.id, FlowBody::Response).unwrap(), compressed);
    assert_eq!(read_body(&ctx.blobs, &flow, FlowBody::Response).await.unwrap(), b"hello proxy");

    let big_url = format!("http://{upstream}/big");
    let resp = client.get(&big_url).send().await.unwrap();
    assert_eq!(resp.bytes().await.unwrap().len(), BIG_BODY);

    let flow = wait_for_flow(&ctx, &big_url).await;
    assert_eq!(flow.request_size, 0);
    assert_eq!(flow.response_size, BIG_BODY as i64);
    assert!(flow.response_truncated);
    let stored = read_raw_body(&ctx.blobs, &flow.id, FlowBody::Response).unwrap();
    assert_eq!(stored, vec![b'x'; CAPTURE_LIMIT]);
    assert!(!ctx.blobs.connect().body_exists(&Flow::body_id(&flow.id, FlowBody::Request)).unwrap());

    ctx.stop().unwrap();
    assert_eq!(ctx.port(), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn early_response_keeps_request_totals() {
    let dir = tempfile::tempdir().unwrap();
    let settings =
        ProxySettings { port: 0, capture_body_limit: CAPTURE_LIMIT, ..Default::default() };
    settings.save(&dir.path().join("settings.json")).unwrap();

    let (events, _event_rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir.path(), events).unwrap();
    ctx.start().unwrap();
    let port = ctx.port().unwrap();

    let upstream = spawn_upstream().await;
    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}")).unwrap())
        .build()
        .unwrap();

    let url = format!("http://{upstream}/early");
    let _ = client.post(&url).body(vec![b'u'; 2 * 1024 * 1024]).send().await;

    let flow = wait_for_flow(&ctx, &url).await;
    assert_eq!(flow.status, Some(200));
    let stored = read_raw_body(&ctx.blobs, &flow.id, FlowBody::Request).unwrap().len() as i64;
    assert!(stored > 0);
    assert!(flow.request_size >= stored, "{} < {stored}", flow.request_size);
    assert_eq!(flow.request_truncated, flow.request_size > stored);
}
