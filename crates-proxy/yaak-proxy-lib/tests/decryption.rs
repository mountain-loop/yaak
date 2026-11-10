//! HTTPS decryption through the engine: why each connection was tunnelled, a client's refused
//! handshake as a flow, the addresses passed through after it, and the open tunnels the decrypt
//! list would decrypt if their clients reconnected.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, RootCertStore};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsConnector;
use yaak_proxy_lib::models::{Flow, TunnelReason};
use yaak_proxy_lib::settings::ProxySettings;
use yaak_proxy_lib::{MasterKeySource, ProxyCtx};
use yaak_rpc::{RpcEvent, RpcEventEmitter};

async fn rpc(ctx: &ProxyCtx, cmd: &str, payload: Value) -> Result<Value, String> {
    yaak_proxy_lib::build_router().dispatch(cmd, payload, ctx).await.map_err(|e| e.message)
}

/// A started engine with `decrypt` as the list, and the events it sends the app.
fn started(decrypt: &[&str]) -> (tempfile::TempDir, ProxyCtx, std::sync::mpsc::Receiver<RpcEvent>) {
    let dir = tempfile::tempdir().unwrap();
    let settings = ProxySettings {
        port: 0,
        system_proxy_at_launch: false,
        decrypt: decrypt.iter().map(|e| e.to_string()).collect(),
        ..Default::default()
    };
    settings.save(&dir.path().join("settings.json")).unwrap();
    let (events, event_rx) = RpcEventEmitter::new();
    let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
    ctx.start().unwrap();
    (dir, ctx, event_rx)
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

/// Opens a CONNECT tunnel to `target` through the engine of `ctx`.
async fn connect_through(ctx: &ProxyCtx, target: &str) -> TcpStream {
    let mut tcp = TcpStream::connect(("127.0.0.1", ctx.port().unwrap())).await.unwrap();
    let connect = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n");
    tcp.write_all(connect.as_bytes()).await.unwrap();
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        head.push(tcp.read_u8().await.unwrap());
    }
    assert!(head.starts_with(b"HTTP/1.1 200"), "{}", String::from_utf8_lossy(&head));
    tcp
}

/// A tunnel whose bytes have crossed both ways, so the engine has judged it and is relaying.
async fn open_tunnel(ctx: &ProxyCtx, target: &str) -> TcpStream {
    let mut tcp = connect_through(ctx, target).await;
    tcp.write_all(b"ping").await.unwrap();
    let mut echoed = [0u8; 4];
    tcp.read_exact(&mut echoed).await.unwrap();
    tcp
}

/// TLS through the engine to `target` from a client that trusts no CA at all, so it refuses the
/// engine's certificate with an `unknown_ca` alert.
async fn refuse_certificate(ctx: &ProxyCtx, target: &str) {
    let config =
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(RootCertStore::empty())
            .with_no_client_auth();
    let tcp = connect_through(ctx, target).await;
    let name = ServerName::try_from("localhost").unwrap();
    let tls = TlsConnector::from(Arc::new(config)).connect(name, tcp).await;
    assert!(tls.is_err(), "trusting nothing, the client refuses the engine's certificate");
}

fn flows(ctx: &ProxyCtx) -> Vec<Flow> {
    ctx.db().unwrap().with_conn(|db| db.find_all::<Flow>().unwrap())
}

async fn wait_for(ctx: &ProxyCtx, what: &str, check: impl Fn(&Flow) -> bool) -> Flow {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(flow) = flows(ctx).into_iter().find(|f| check(f)) {
            return flow;
        }
        assert!(Instant::now() < deadline, "no flow {what}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// Waits until `check` holds of what `list_reconnectable_tunnels` returns for `scope`.
async fn wait_for_tunnels(ctx: &ProxyCtx, scope: Value, check: impl Fn(&[Value]) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let tunnels = rpc(ctx, "list_reconnectable_tunnels", scope.clone()).await.unwrap();
        if check(tunnels.as_array().unwrap()) {
            return;
        }
        assert!(Instant::now() < deadline, "tunnels for {scope} stayed {tunnels}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn reconnectable(ctx: &ProxyCtx, scope: Value) -> Vec<Value> {
    let tunnels = rpc(ctx, "list_reconnectable_tunnels", scope).await.unwrap();
    tunnels.as_array().unwrap().clone()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_tunnel_records_why_it_was_not_decrypted() {
    let (_dir, ctx, _events) = started(&["host:localhost", "!host:localhost"]);
    let echo = spawn_echo().await;

    // Nothing names 127.0.0.1.
    let _plain = open_tunnel(&ctx, &format!("127.0.0.1:{}", echo.port())).await;
    let url = format!("https://127.0.0.1:{}", echo.port());
    let flow = wait_for(&ctx, "to 127.0.0.1", |f| f.url == url).await;
    assert_eq!(flow.tunnel_reason, Some(TunnelReason::NotListed));
    assert_eq!((flow.tunnel_excluded_by, flow.tunnel_rejected_by), (None, None));

    // The person's exclusion beats their entry.
    let _excluded = open_tunnel(&ctx, &format!("localhost:{}", echo.port())).await;
    let url = format!("https://localhost:{}", echo.port());
    let flow = wait_for(&ctx, "to localhost", |f| f.url == url).await;
    assert_eq!(flow.tunnel_reason, Some(TunnelReason::Excluded));
    assert_eq!(flow.tunnel_excluded_by.as_deref(), Some("!host:localhost"));
    assert!(!flow.tunnel_excluded_built_in);

    let encrypted = rpc(&ctx, "list_flows", json!({"query": "@is:encrypted"})).await.unwrap();
    assert_eq!(encrypted["flows"].as_array().unwrap().len(), 2);
    let flow = &encrypted["flows"][0];
    assert_eq!(flow["tunnelReason"], "excluded");
    assert_eq!(flow["tunnelExcludedBy"], "!host:localhost");
}

/// A client refusing the certificate is one flow per address, however many refuse together,
/// and the tunnels passed through after it name it.
#[tokio::test(flavor = "multi_thread")]
async fn a_refused_handshake_is_one_flow_per_address() {
    let (_dir, ctx, events) = started(&["*"]);
    let echo = spawn_echo().await;
    let target = format!("localhost:{}", echo.port());
    let url = format!("https://{target}");

    refuse_certificate(&ctx, &target).await;
    let rejected = wait_for(&ctx, "refused", |f| f.tls_rejected.is_some()).await;
    assert_eq!(rejected.url, url);
    assert_eq!(rejected.method, "");
    assert_eq!(rejected.tls_rejected.as_deref(), Some("unknown_ca"));
    assert_eq!(rejected.error.as_deref(), Some("Rejected the proxy's certificate"));
    assert!(!rejected.tunnelled);
    assert!(rejected.elapsed_ms.is_some(), "ended, not pending");
    // No request was sent, so there is none to save.
    let preview = rpc(&ctx, "preview_save", json!({"flowId": rejected.id})).await;
    assert!(preview.unwrap_err().starts_with("Not a request"));

    // Passed through from now on, naming the refusal.
    let _tunnel = open_tunnel(&ctx, &target).await;
    let tunnel = wait_for(&ctx, "passed through", |f| f.tunnelled && f.url == url).await;
    assert_eq!(tunnel.tunnel_reason, Some(TunnelReason::Rejected));
    assert_eq!(tunnel.tunnel_rejected_by.as_deref(), Some(rejected.id.as_str()));
    // It would be passed through again, so it is no tunnel to reconnect.
    assert!(reconnectable(&ctx, json!({})).await.is_empty());

    // Several refusing at once to another address make one flow too.
    let other = format!("127.0.0.1:{}", echo.port());
    let mut tunnels = Vec::new();
    for _ in 0..6 {
        tunnels.push(connect_through(&ctx, &other).await);
    }
    let config = Arc::new(
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(RootCertStore::empty())
            .with_no_client_auth(),
    );
    let attempts: Vec<_> = tunnels
        .into_iter()
        .map(|tcp| {
            let connector = TlsConnector::from(config.clone());
            let name = ServerName::try_from("localhost").unwrap();
            tokio::spawn(async move { connector.connect(name, tcp).await.map(drop) })
        })
        .collect();
    for attempt in attempts {
        let _ = attempt.await.unwrap();
    }
    let other_url = format!("https://{other}");
    wait_for(&ctx, "refused at once", |f| f.url == other_url && f.tls_rejected.is_some()).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    let refused: Vec<Flow> = flows(&ctx).into_iter().filter(|f| f.tls_rejected.is_some()).collect();
    assert_eq!(refused.len(), 2, "one for each address: {refused:#?}");
    let listed = rpc(&ctx, "list_flows", json!({"query": "@is:rejected"})).await.unwrap();
    assert_eq!(listed["flows"].as_array().unwrap().len(), 2);

    // The set, read and changed.
    let set = rpc(&ctx, "list_passthrough", json!({})).await.unwrap();
    assert_eq!(set["addresses"], json!([other, target]));
    let pushed: Vec<RpcEvent> =
        events.try_iter().filter(|e| e.event == "passthrough_changed").collect();
    assert_eq!(pushed.len(), 2, "one push as each address was added");
    assert_eq!(pushed[1].payload["addresses"], json!([other, target]));

    // Forgotten, by the flow's authority, the address is intercepted again, and a refusal is
    // another flow.
    let forgot = rpc(&ctx, "forget_passthrough", json!({"address": target})).await.unwrap();
    assert_eq!(forgot, json!({"forgotten": true, "addresses": [other]}));
    let pushed: Vec<RpcEvent> =
        events.try_iter().filter(|e| e.event == "passthrough_changed").collect();
    assert_eq!(pushed.len(), 1);
    assert_eq!(pushed[0].payload["addresses"], json!([other]));
    // Its tunnel still open would now be decrypted if it reconnected.
    let open = reconnectable(&ctx, json!({"flowId": tunnel.id})).await;
    assert_eq!(open.len(), 1, "forgotten, its tunnel counts again");
    let again = rpc(&ctx, "forget_passthrough", json!({"address": target})).await.unwrap();
    assert_eq!(again["forgotten"], false);
    assert!(rpc(&ctx, "forget_passthrough", json!({"address": ""})).await.is_err());
    refuse_certificate(&ctx, &target).await;
    let deadline = Instant::now() + Duration::from_secs(5);
    while flows(&ctx).iter().filter(|f| f.url == url && f.tls_rejected.is_some()).count() < 2 {
        assert!(Instant::now() < deadline, "no second refusal");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// Open tunnels are kept whether or not flows are recorded; saving the list closes none of
/// them but counts those it would decrypt, and reconnecting closes them by flow, by entry or
/// all at once.
#[tokio::test(flavor = "multi_thread")]
async fn open_tunnels_are_reconnected_only_when_asked() {
    let (_dir, ctx, _events) = started(&[]);
    let echo = spawn_echo().await;
    let local = format!("localhost:{}", echo.port());
    let loopback = format!("127.0.0.1:{}", echo.port());

    let mut a = open_tunnel(&ctx, &local).await;
    let a_flow = wait_for(&ctx, "a", |f| f.url == format!("https://{local}")).await;
    let mut b = open_tunnel(&ctx, &loopback).await;
    let b_flow = wait_for(&ctx, "b", |f| f.url == format!("https://{loopback}")).await;
    // Paused, a tunnel has no flow, and is kept all the same.
    rpc(&ctx, "set_recording", json!({"enabled": false})).await.unwrap();
    let mut c = open_tunnel(&ctx, &local).await;

    // Nothing is listed, so nothing would be decrypted.
    assert!(reconnectable(&ctx, json!({})).await.is_empty());
    let saved = rpc(&ctx, "edit_decrypt_list", json!({"add": ["host:localhost"]})).await.unwrap();
    assert!(saved["stillEncrypted"].as_u64().unwrap() <= 2);
    wait_for_tunnels(&ctx, json!({}), |t| t.len() == 2).await;
    let listed = reconnectable(&ctx, json!({})).await;
    assert_eq!(listed[0]["flowId"], json!(a_flow.id));
    assert_eq!(listed[0]["host"], "localhost");
    assert_eq!(listed[0]["port"], echo.port());
    assert_eq!(listed[0]["reason"], "not_listed");
    assert_eq!(listed[1]["flowId"], Value::Null, "opened while paused");

    // Saving counts what stays encrypted, and closes nothing.
    let saved = rpc(&ctx, "edit_decrypt_list", json!({"add": ["127.0.0.1"]})).await.unwrap();
    assert_eq!(saved["stillEncrypted"], 3);
    for tcp in [&mut a, &mut b, &mut c] {
        tcp.write_all(b"ping").await.unwrap();
        let mut echoed = [0u8; 4];
        tcp.read_exact(&mut echoed).await.unwrap();
    }

    // Narrowed to an entry, or to a flow.
    let entry = reconnectable(&ctx, json!({"entry": "host:127.0.0.1"})).await;
    assert_eq!(entry.len(), 1);
    assert_eq!(entry[0]["flowId"], json!(b_flow.id));
    assert_eq!(reconnectable(&ctx, json!({"flowId": a_flow.id})).await.len(), 1);
    assert!(rpc(&ctx, "list_reconnectable_tunnels", json!({"entry": "host:a b"})).await.is_err());

    // By flow.
    let closed = rpc(&ctx, "reconnect_tunnels", json!({"flowId": a_flow.id})).await.unwrap();
    assert_eq!(closed, json!({"closed": 1}));
    let mut rest = Vec::new();
    a.read_to_end(&mut rest).await.unwrap();
    let ended = wait_for(&ctx, "a ended", |f| f.id == a_flow.id && f.elapsed_ms.is_some()).await;
    assert!(ended.reconnect_requested);
    assert_eq!(ended.error, None);

    // By entry.
    let closed = rpc(&ctx, "reconnect_tunnels", json!({"entry": "127.0.0.1"})).await.unwrap();
    assert_eq!(closed["closed"], 1);
    b.read_to_end(&mut rest).await.unwrap();
    let ended = wait_for(&ctx, "b ended", |f| f.id == b_flow.id && f.elapsed_ms.is_some()).await;
    assert!(ended.reconnect_requested);

    // All, and by id what is closed already.
    wait_for_tunnels(&ctx, json!({}), |t| t.len() == 1).await;
    let id = reconnectable(&ctx, json!({})).await[0]["id"].clone();
    let closed = rpc(&ctx, "reconnect_tunnels", json!({})).await.unwrap();
    assert_eq!(closed["closed"], 1);
    c.read_to_end(&mut rest).await.unwrap();
    wait_for_tunnels(&ctx, json!({}), |t| t.is_empty()).await;
    let closed = rpc(&ctx, "reconnect_tunnels", json!({"ids": [id]})).await.unwrap();
    assert_eq!(closed["closed"], 0);

    // An id listed before the engine restarted closes nothing after, though the new run
    // numbers its tunnels from 1 again. Each is opened while its host is unlisted.
    let unlisted = || rpc(&ctx, "edit_decrypt_list", json!({"remove": ["host:127.0.0.1"]}));
    let listed = || rpc(&ctx, "edit_decrypt_list", json!({"add": ["host:127.0.0.1"]}));
    unlisted().await.unwrap();
    let mut d = open_tunnel(&ctx, &loopback).await;
    listed().await.unwrap();
    wait_for_tunnels(&ctx, json!({}), |t| t.len() == 1).await;
    let old = reconnectable(&ctx, json!({})).await[0]["id"].clone();
    ctx.stop().unwrap();
    // Stopped, nothing is open, at once, whatever its event loop has still to read.
    assert!(reconnectable(&ctx, json!({})).await.is_empty());
    assert_eq!(listed().await.unwrap()["stillEncrypted"], 0);
    assert_eq!(rpc(&ctx, "reconnect_tunnels", json!({"ids": [old]})).await.unwrap()["closed"], 0);
    assert_eq!(rpc(&ctx, "list_passthrough", json!({})).await.unwrap()["addresses"], json!([]));
    let forgot = rpc(&ctx, "forget_passthrough", json!({"address": "localhost"})).await.unwrap();
    assert_eq!(forgot, json!({"forgotten": false, "addresses": []}));
    d.read_to_end(&mut rest).await.unwrap();
    ctx.start().unwrap();
    unlisted().await.unwrap();
    let mut e = open_tunnel(&ctx, &loopback).await;
    listed().await.unwrap();
    wait_for_tunnels(&ctx, json!({}), |t| t.len() == 1).await;
    assert_ne!(reconnectable(&ctx, json!({})).await[0]["id"], old);
    let closed = rpc(&ctx, "reconnect_tunnels", json!({"ids": [old]})).await.unwrap();
    assert_eq!(closed["closed"], 0);
    e.write_all(b"ping").await.unwrap();
    let mut echoed = [0u8; 4];
    e.read_exact(&mut echoed).await.unwrap();
}

/// Dropping the last context stops its engine, which its event loop does not keep alive.
#[tokio::test(flavor = "multi_thread")]
async fn dropping_the_context_stops_the_engine() {
    let (_dir, ctx, _events) = started(&[]);
    let port = ctx.port().unwrap();
    drop(ctx);
    let deadline = Instant::now() + Duration::from_secs(5);
    while TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
        assert!(Instant::now() < deadline, "the engine still listens on {port}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// A tunnel that ends on its own is no longer open, and is not marked for a reconnect.
#[tokio::test(flavor = "multi_thread")]
async fn a_closed_tunnel_leaves_the_registry() {
    let (_dir, ctx, _events) = started(&["*"]);
    let echo = spawn_echo().await;
    // Kept out by the built-in exclusions' rival, an exclusion of the person's.
    rpc(&ctx, "edit_decrypt_list", json!({"add": ["!host:localhost"]})).await.unwrap();
    let tcp = open_tunnel(&ctx, &format!("localhost:{}", echo.port())).await;
    let url = format!("https://localhost:{}", echo.port());
    wait_for(&ctx, "open", |f| f.url == url).await;
    let saved = rpc(&ctx, "edit_decrypt_list", json!({"remove": ["!host:localhost"]})).await;
    assert_eq!(saved.unwrap()["stillEncrypted"], 1);
    drop(tcp);
    let ended = wait_for(&ctx, "ended", |f| f.url == url && f.elapsed_ms.is_some()).await;
    assert!(!ended.reconnect_requested);
    wait_for_tunnels(&ctx, json!({}), |t| t.is_empty()).await;
}
