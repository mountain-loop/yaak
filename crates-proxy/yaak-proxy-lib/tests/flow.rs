use std::convert::Infallible;
use std::io::Write;
use std::net::SocketAddr;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use bytes::Bytes;
use flate2::Compression;
use flate2::write::GzEncoder;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use serde_json::{Value, json};
use tokio::net::TcpListener;
use yaak_proxy_lib::bodies::{DecodedBody, read_body, read_raw_body};
use yaak_proxy_lib::models::{Flow, FlowBody};
use yaak_proxy_lib::settings::ProxySettings;
use yaak_proxy_lib::{MasterKeySource, ProxyCtx};
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
        // Small on the wire, past the capture limit once decoded.
        "/expands" => Response::builder()
            .header("content-type", "text/plain")
            .header("content-encoding", "gzip")
            .body(Full::from(gzip(&vec![b'z'; BIG_BODY])))
            .unwrap(),
        "/json" => Response::builder()
            .header("content-type", "application/json")
            .body(Full::from(r#"{"items":[{"id":1},{"id":2}]}"#))
            .unwrap(),
        // Names an encoding but, like any 304, has no body
        "/not-modified" => Response::builder()
            .status(304)
            .header("content-encoding", "gzip")
            .body(Full::new(Bytes::new()))
            .unwrap(),
        "/hang" => std::future::pending().await,
        // XML that only its body says is XML
        "/xml-as-text" => Response::builder()
            .header("content-type", "text/plain")
            .body(Full::from("<items><id>1</id><id>2</id></items>"))
            .unwrap(),
        _ => Response::new(Full::from(vec![b'x'; BIG_BODY])),
    })
}

async fn spawn_upstream() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            tokio::spawn(
                http1::Builder::new().serve_connection(TokioIo::new(tcp), service_fn(route)),
            );
        }
    });
    addr
}

/// Waits for the event loop to write the flow for `url`.
async fn wait_for_flow(ctx: &ProxyCtx, url: &str) -> Flow {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let flows = ctx.db().unwrap().with_conn(|db| db.find_all::<Flow>().unwrap());
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
    let settings = ProxySettings {
        port: 0,
        capture_body_limit: CAPTURE_LIMIT,
        system_proxy_at_launch: false,
        ..Default::default()
    };
    settings.save(&dir.path().join("settings.json")).unwrap();

    let (events, _event_rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
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

    assert_eq!(
        read_raw_body(&ctx.blobs().unwrap(), &flow.id, FlowBody::Request).unwrap(),
        b"hello proxy"
    );
    assert_eq!(
        read_raw_body(&ctx.blobs().unwrap(), &flow.id, FlowBody::Response).unwrap(),
        compressed
    );
    let decoded = read_body(
        &ctx.db().unwrap(),
        &ctx.blobs().unwrap(),
        &flow,
        FlowBody::Response,
        CAPTURE_LIMIT,
    )
    .await
    .unwrap();
    let expected = DecodedBody {
        data: b"hello proxy".to_vec(),
        stored_size: compressed.len(),
        truncated: false,
        decode_error: None,
        note: None,
    };
    assert_eq!(decoded, expected);

    let big_url = format!("http://{upstream}/big");
    let resp = client.get(&big_url).send().await.unwrap();
    assert_eq!(resp.bytes().await.unwrap().len(), BIG_BODY);

    let flow = wait_for_flow(&ctx, &big_url).await;
    assert_eq!(flow.request_size, 0);
    assert_eq!(flow.response_size, BIG_BODY as i64);
    assert!(flow.response_truncated);
    let stored = read_raw_body(&ctx.blobs().unwrap(), &flow.id, FlowBody::Response).unwrap();
    assert_eq!(stored, vec![b'x'; CAPTURE_LIMIT]);
    assert!(
        !ctx.blobs()
            .unwrap()
            .connect()
            .body_exists(&Flow::body_id(&flow.id, FlowBody::Request))
            .unwrap()
    );

    ctx.stop().unwrap();
    assert_eq!(ctx.port(), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn early_response_keeps_request_totals() {
    let dir = tempfile::tempdir().unwrap();
    let settings = ProxySettings {
        port: 0,
        capture_body_limit: CAPTURE_LIMIT,
        system_proxy_at_launch: false,
        ..Default::default()
    };
    settings.save(&dir.path().join("settings.json")).unwrap();

    let (events, _event_rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
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
    let stored =
        read_raw_body(&ctx.blobs().unwrap(), &flow.id, FlowBody::Request).unwrap().len() as i64;
    assert!(stored > 0);
    assert!(flow.request_size >= stored, "{} < {stored}", flow.request_size);
    assert_eq!(flow.request_truncated, flow.request_size > stored);
}

async fn rpc(ctx: &ProxyCtx, cmd: &str, payload: Value) -> Result<Value, String> {
    yaak_proxy_lib::build_router().dispatch(cmd, payload, ctx).await.map_err(|e| e.message)
}

/// A request the client gives up on is stored as cancelled, not as an error.
#[tokio::test(flavor = "multi_thread")]
async fn cancelled_flow_is_not_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let settings = ProxySettings { port: 0, system_proxy_at_launch: false, ..Default::default() };
    settings.save(&dir.path().join("settings.json")).unwrap();

    let (events, _event_rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
    ctx.start().unwrap();
    let port = ctx.port().unwrap();

    let upstream = spawn_upstream().await;
    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}")).unwrap())
        .timeout(Duration::from_millis(300))
        .build()
        .unwrap();
    let url = format!("http://{upstream}/hang");
    assert!(client.get(&url).send().await.unwrap_err().is_timeout());

    let flow = wait_for_flow(&ctx, &url).await;
    assert!(flow.cancelled);
    assert_eq!((flow.error, flow.status), (None, None));
    assert!(flow.elapsed_ms.is_some());
}

/// `http1Only` is saved and reaches the running engine: the next connection from a client that
/// offers HTTP/2 speaks HTTP/1.1, and `auto` brings HTTP/2 back.
#[tokio::test(flavor = "multi_thread")]
async fn http_version_setting_applies_to_new_connections() {
    let dir = tempfile::tempdir().unwrap();
    // Decrypted, as only intercepted HTTPS offers the client a version.
    let settings = ProxySettings {
        port: 0,
        system_proxy_at_launch: false,
        decrypt: vec!["*".into()],
        ..Default::default()
    };
    settings.save(&dir.path().join("settings.json")).unwrap();

    let (events, _event_rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
    ctx.start().unwrap();
    let port = ctx.port().unwrap();
    let ca = std::fs::read(dir.path().join("ca/ca.pem")).unwrap();
    // Nothing listens there, so each flow is a 502, but its client side is spoken all the same.
    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap().port();

    let mut sent = 0;
    let mut client_version = async || {
        sent += 1;
        // A client of its own, so a connection of its own.
        let client = reqwest::Client::builder()
            .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}")).unwrap())
            .add_root_certificate(reqwest::Certificate::from_pem(&ca).unwrap())
            .build()
            .unwrap();
        let url = format!("https://localhost:{closed}/{sent}");
        assert_eq!(client.get(&url).send().await.unwrap().status(), 502);
        wait_for_flow(&ctx, &url).await.client_http_version
    };

    assert_eq!(client_version().await, "HTTP/2");
    let set = rpc(&ctx, "set_http_version", json!({"httpVersion": "http1Only"})).await.unwrap();
    assert_eq!(set, json!("http1Only"));
    assert_eq!(rpc(&ctx, "get_proxy_state", json!({})).await.unwrap()["httpVersion"], "http1Only");
    assert_eq!(client_version().await, "HTTP/1.1");

    rpc(&ctx, "set_http_version", json!({"httpVersion": "auto"})).await.unwrap();
    assert_eq!(client_version().await, "HTTP/2");
    let saved = ProxySettings::load(&dir.path().join("settings.json")).unwrap();
    assert_eq!(saved.http_version, yaak_proxy_lib::settings::HttpVersion::Auto);
}

#[tokio::test(flavor = "multi_thread")]
async fn body_rpcs() {
    let dir = tempfile::tempdir().unwrap();
    let settings = ProxySettings {
        port: 0,
        capture_body_limit: CAPTURE_LIMIT,
        system_proxy_at_launch: false,
        ..Default::default()
    };
    settings.save(&dir.path().join("settings.json")).unwrap();

    let (events, _event_rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
    ctx.start().unwrap();
    let port = ctx.port().unwrap();

    let state = rpc(&ctx, "get_proxy_state", json!({})).await.unwrap();
    assert_eq!(
        state,
        json!({
            "state": "running",
            "port": port,
            "configuredPort": 0,
            "recording": true,
            "systemProxyAtLaunch": false,
            "httpVersion": "auto",
            "captureBodyLimit": CAPTURE_LIMIT,
            "traffic": "clearOnLaunch",
            "keepTrafficBytes": null,
            "startError": null,
            "encrypting": null,
            "locked": null,
            "otherOwner": null,
        })
    );

    let upstream = spawn_upstream().await;
    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}")).unwrap())
        .build()
        .unwrap();

    let expands_url = format!("http://{upstream}/expands");
    client.get(&expands_url).send().await.unwrap().bytes().await.unwrap();
    let flow = wait_for_flow(&ctx, &expands_url).await;
    assert!(!flow.response_truncated);
    let body =
        rpc(&ctx, "get_flow_body", json!({"flowId": flow.id, "which": "response"})).await.unwrap();
    assert_eq!(body["truncated"], json!(true));
    assert!(body["storedSize"].as_u64().unwrap() < CAPTURE_LIMIT as u64);
    let data = BASE64.decode(body["data"].as_str().unwrap()).unwrap();
    assert_eq!(data, vec![b'z'; CAPTURE_LIMIT]);

    let empty =
        rpc(&ctx, "get_flow_body", json!({"flowId": flow.id, "which": "request"})).await.unwrap();
    assert_eq!(empty, json!({"data": "", "truncated": false, "storedSize": 0}));

    let not_modified_url = format!("http://{upstream}/not-modified");
    client.get(&not_modified_url).send().await.unwrap().bytes().await.unwrap();
    let flow = wait_for_flow(&ctx, &not_modified_url).await;
    let body =
        rpc(&ctx, "get_flow_body", json!({"flowId": flow.id, "which": "response"})).await.unwrap();
    assert_eq!(body, json!({"data": "", "truncated": false, "storedSize": 0}));

    let json_url = format!("http://{upstream}/json");
    client.get(&json_url).send().await.unwrap().bytes().await.unwrap();
    let flow = wait_for_flow(&ctx, &json_url).await;
    let filtered = rpc(
        &ctx,
        "filter_body",
        json!({"flowId": flow.id, "which": "response", "expression": "$.items[*].id"}),
    )
    .await
    .unwrap();
    assert_eq!(filtered, json!({"content": "[\n  1,\n  2\n]", "error": null}));
    let invalid = rpc(
        &ctx,
        "filter_body",
        json!({"flowId": flow.id, "which": "response", "expression": "$.items[?(@.id ==)]"}),
    )
    .await
    .unwrap();
    assert_eq!(invalid["content"], json!(""));
    assert!(invalid["error"].is_string());

    let xml_url = format!("http://{upstream}/xml-as-text");
    client.get(&xml_url).send().await.unwrap().bytes().await.unwrap();
    let flow = wait_for_flow(&ctx, &xml_url).await;
    let xpath = json!({
        "flowId": flow.id,
        "which": "response",
        "expression": "//id[2]",
        "language": "xpath",
    });
    let filtered = rpc(&ctx, "filter_body", xpath).await.unwrap();
    assert_eq!(filtered, json!({"content": "<id>2</id>", "error": null}));
    // Without the viewer's language, `text/plain` means JSONPath, which can't read XML
    let by_header = rpc(
        &ctx,
        "filter_body",
        json!({"flowId": flow.id, "which": "response", "expression": "//id[2]"}),
    )
    .await
    .unwrap();
    assert_eq!(by_header["content"], json!(""));
    assert!(by_header["error"].is_string());

    let missing =
        rpc(&ctx, "get_flow_body", json!({"flowId": "fl_missing", "which": "response"})).await;
    assert!(missing.is_err());

    let formatted = rpc(&ctx, "format_body", json!({"text": r#"{"a":[1,2]}"#})).await.unwrap();
    assert_eq!(formatted, json!("{\n  \"a\": [\n    1,\n    2\n  ]\n}"));
}

/// A TCP server that echoes what it reads, then closes once the client does.
async fn spawn_echo() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (mut tcp, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let (mut read, mut write) = tcp.split();
                let _ = tokio::io::copy(&mut read, &mut write).await;
            });
        }
    });
    addr
}

/// Opens a CONNECT tunnel to `target` through the engine on `port`.
async fn connect_through(port: u16, target: &str) -> tokio::net::TcpStream {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut tcp = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let connect = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n");
    tcp.write_all(connect.as_bytes()).await.unwrap();
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        head.push(tcp.read_u8().await.unwrap());
    }
    assert!(head.starts_with(b"HTTP/1.1 200"), "{}", String::from_utf8_lossy(&head));
    tcp
}

async fn wait_for(ctx: &ProxyCtx, check: impl Fn(&Flow) -> bool) -> Flow {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let flows = ctx.db().unwrap().with_conn(|db| db.find_all::<Flow>().unwrap());
        if let Some(flow) = flows.into_iter().find(|f| check(f)) {
            return flow;
        }
        assert!(Instant::now() < deadline, "no such flow");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// With the default, empty decrypt list, a CONNECT is tunnelled untouched and recorded as a flow
/// with its host and the bytes each way, shown while open and finished once closed.
#[tokio::test(flavor = "multi_thread")]
async fn a_tunnelled_connect_is_recorded_with_its_sizes() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let dir = tempfile::tempdir().unwrap();
    let settings = ProxySettings { port: 0, system_proxy_at_launch: false, ..Default::default() };
    settings.save(&dir.path().join("settings.json")).unwrap();
    let (events, _event_rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
    ctx.start().unwrap();
    let port = ctx.port().unwrap();
    let echo = spawn_echo().await;
    let target = format!("localhost:{}", echo.port());
    let url = format!("https://{target}");

    let mut tcp = connect_through(port, &target).await;
    // TLS-looking bytes, which a decrypting engine would have taken for a ClientHello.
    let sent = b"\x16\x03\x01 not decrypted";
    tcp.write_all(sent).await.unwrap();
    let mut echoed = vec![0u8; sent.len()];
    tcp.read_exact(&mut echoed).await.unwrap();
    assert_eq!(&echoed, sent, "bytes pass untouched");

    let open = wait_for(&ctx, |f| f.url == url).await;
    assert!(open.tunnelled);
    assert_eq!(open.method, "CONNECT");
    assert_eq!(open.elapsed_ms, None, "open while the tunnel is");

    drop(tcp);
    let done = wait_for(&ctx, |f| f.url == url && f.elapsed_ms.is_some()).await;
    assert_eq!(done.id, open.id);
    assert_eq!((done.request_size, done.response_size), (sent.len() as i64, sent.len() as i64));
    assert_eq!(done.error, None);
    assert!(done.request_headers.is_empty() && done.response_headers.is_empty());

    let tunnelled = rpc(&ctx, "list_flows", json!({"query": "@is:tunnelled"})).await.unwrap();
    assert_eq!(tunnelled["flows"].as_array().unwrap().len(), 1);
    assert_eq!(tunnelled["flows"][0]["tunnelled"], true);
    let decrypted = rpc(&ctx, "list_flows", json!({"query": "-@is:tunnelled"})).await.unwrap();
    assert_eq!(decrypted["flows"].as_array().unwrap().len(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_decrypt_list_rpcs_save_and_apply() {
    let dir = tempfile::tempdir().unwrap();
    let settings = ProxySettings { port: 0, system_proxy_at_launch: false, ..Default::default() };
    settings.save(&dir.path().join("settings.json")).unwrap();
    let (events, _event_rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();

    let list = rpc(&ctx, "get_decrypt_list", json!({})).await.unwrap();
    let entries = list["entries"].as_array().unwrap();
    assert!(entries.iter().all(|e| e["builtIn"] == true), "only the built-ins: {list}");
    assert!(entries.iter().any(|e| e["entry"] == "!host:*.apple.com"));

    let set = json!({"entries": ["API.example.com", "app:Google Chrome", "!host:*.apple.com"]});
    let list = rpc(&ctx, "set_decrypt_list", set).await.unwrap();
    assert_eq!(
        list["entries"],
        json!([
            {"entry": "host:api.example.com", "builtIn": false},
            {"entry": "app:Google Chrome", "builtIn": false},
            {"entry": "!host:*.apple.com", "builtIn": true, "kind": "apple"},
        ])
    );
    assert_eq!(list["stillEncrypted"], 0);
    let saved = ProxySettings::load(&dir.path().join("settings.json")).unwrap();
    assert_eq!(saved.decrypt, ["host:api.example.com", "app:Google Chrome"]);
    assert!(saved.decrypt_built_ins_removed.contains(&"!host:*.icloud.com".to_string()));

    let invalid = rpc(&ctx, "set_decrypt_list", json!({"entries": ["host:a b"]})).await;
    assert!(invalid.unwrap_err().contains("Invalid host"));
    assert_eq!(rpc(&ctx, "get_decrypt_list", json!({})).await.unwrap()["entries"], list["entries"]);

    // Applied to the running engine's next connection: decrypting everything intercepts a
    // CONNECT, which a client that does not trust the CA then rejects.
    ctx.start().unwrap();
    rpc(&ctx, "set_decrypt_list", json!({"entries": ["*"]})).await.unwrap();
    let echo = spawn_echo().await;
    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{}", ctx.port().unwrap())).unwrap())
        .build()
        .unwrap();
    let err = client.get(format!("https://localhost:{}/", echo.port())).send().await.unwrap_err();
    assert!(err.is_connect() || err.is_request(), "{err:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn seen_lists_hosts_and_apps_most_recent_first() {
    let dir = tempfile::tempdir().unwrap();
    let settings = ProxySettings { port: 0, system_proxy_at_launch: false, ..Default::default() };
    settings.save(&dir.path().join("settings.json")).unwrap();
    let (events, _event_rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
    let flow = |url: &str, app: Option<(&str, Option<&str>)>, at: i64| Flow {
        id: format!("fl_{at}"),
        url: url.into(),
        method: "GET".into(),
        started_at: chrono::DateTime::from_timestamp(at, 0).unwrap().naive_utc(),
        client_name: app.map(|(n, _)| n.to_string()),
        client_bundle_id: app.and_then(|(_, b)| b.map(String::from)),
        ..Default::default()
    };
    let chrome = Some(("Google Chrome", Some("com.google.Chrome")));
    ctx.db()
        .unwrap()
        .with_tx(|c| {
            for f in [
                flow("https://api.example.com/v1", chrome, 1),
                flow("https://API.example.com:443/v2", None, 2),
                flow("https://example.com:8443/", Some(("curl", None)), 3),
                flow("http://localhost:80/x", chrome, 4),
            ] {
                c.upsert(&f, &yaak_database::UpdateSource::Background)?;
            }
            Ok::<_, yaak_database::Error>(())
        })
        .unwrap();

    let seen = rpc(&ctx, "list_seen", json!({})).await.unwrap();
    assert_eq!(seen["hosts"], json!(["localhost", "example.com:8443", "api.example.com"]));
    assert_eq!(
        seen["apps"],
        json!([
            {"name": "Google Chrome", "bundleId": "com.google.Chrome"},
            {"name": "curl", "bundleId": null},
        ])
    );
}

/// Edits made together each land on the list the other left, and every change is announced to
/// the app, so a list changed elsewhere shows at once.
#[tokio::test(flavor = "multi_thread")]
async fn decrypt_list_edits_apply_to_the_latest_list_and_are_announced() {
    let dir = tempfile::tempdir().unwrap();
    let settings = ProxySettings { port: 0, system_proxy_at_launch: false, ..Default::default() };
    settings.save(&dir.path().join("settings.json")).unwrap();
    let (events, event_rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();

    let (a, b) = tokio::join!(
        rpc(&ctx, "edit_decrypt_list", json!({"add": ["a.com"]})),
        rpc(&ctx, "edit_decrypt_list", json!({"add": ["app:Slack"]})),
    );
    a.unwrap();
    b.unwrap();
    let list =
        rpc(&ctx, "edit_decrypt_list", json!({"remove": ["!host:*.zoom.us"]})).await.unwrap();
    let user: Vec<&str> = list["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["builtIn"] == false)
        .map(|e| e["entry"].as_str().unwrap())
        .collect();
    assert_eq!(user.len(), 2);
    assert!(user.contains(&"host:a.com") && user.contains(&"app:Slack"), "{user:?}");
    assert!(!list["entries"].as_array().unwrap().iter().any(|e| e["entry"] == "!host:*.zoom.us"));

    let changes: Vec<_> =
        event_rx.try_iter().filter(|e| e.event == "decrypt_list_changed").collect();
    assert_eq!(changes.len(), 3);
    assert_eq!(changes[2].payload["list"]["entries"], list["entries"]);
}

/// Capture throughput through the engine, end to end: 3,000 requests, 16 at a time over
/// kept-alive connections, each with a 4 KB response, timed until every flow is stored, and how
/// long opening one then takes. Run in release: `cargo test --release -p yaak-proxy-lib --test
/// flow times_capture -- --ignored --nocapture`.
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn times_capture_through_the_engine() {
    const FLOWS: usize = 3_000;
    const AT_ONCE: usize = 16;
    let upstream = spawn_upstream().await;
    let dir = tempfile::tempdir().unwrap();
    let settings = ProxySettings { port: 0, system_proxy_at_launch: false, ..Default::default() };
    settings.save(&dir.path().join("settings.json")).unwrap();
    let (events, _rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
    ctx.start().unwrap();
    let proxy = format!("http://127.0.0.1:{}", ctx.port().unwrap());
    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::http(&proxy).unwrap())
        .pool_max_idle_per_host(AT_ONCE)
        .build()
        .unwrap();

    let started = Instant::now();
    let next = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let workers: Vec<_> = (0..AT_ONCE)
        .map(|_| {
            let (client, next) = (client.clone(), next.clone());
            tokio::spawn(async move {
                loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    if i >= FLOWS {
                        return;
                    }
                    let url = format!("http://{upstream}/v1/items/{i}?api_key=sk_test_123");
                    let resp = client.get(&url).header("authorization", "Bearer abc").send();
                    assert_eq!(resp.await.unwrap().bytes().await.unwrap().len(), BIG_BODY);
                }
            })
        })
        .collect();
    for worker in workers {
        worker.await.unwrap();
    }
    let db = ctx.db().unwrap();
    while yaak_proxy_lib::flows::count(&db).unwrap() < FLOWS {
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    let capture = started.elapsed();

    let ids: Vec<String> = yaak_proxy_lib::flows::list(&db, &Default::default())
        .unwrap()
        .into_iter()
        .map(|f| f.id)
        .collect();
    let blobs = ctx.blobs().unwrap();
    let started = Instant::now();
    for id in &ids {
        let flow = yaak_proxy_lib::flows::get(&db, id).unwrap();
        read_raw_body(&blobs, &flow.id, FlowBody::Response).unwrap();
    }
    let open = started.elapsed() / ids.len() as u32;
    ctx.stop().unwrap();
    eprintln!(
        "{FLOWS} flows through the engine in {capture:?}: {:.0} flows/s; opening one: {open:?}",
        FLOWS as f64 / capture.as_secs_f64()
    );
}
