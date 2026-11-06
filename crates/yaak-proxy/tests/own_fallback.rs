//! The engine's own upstream falling back to the system proxy, which is the engine. Its own test
//! binary, since the proxy is set for the whole process.
#![cfg(target_os = "macos")]

use std::ffi::{CString, c_void};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, RootCertStore};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt, copy_bidirectional};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsConnector;
use yaak_proxy::{CaStore, ProxyConfig, start_proxy};

type NwObject = *mut c_void;

#[link(name = "Network", kind = "framework")]
unsafe extern "C" {
    static _nw_privacy_context_default_context: NwObject;
    fn nw_endpoint_create_host(host: *const i8, port: *const i8) -> NwObject;
    fn nw_proxy_config_create_http_connect(endpoint: NwObject, tls: NwObject) -> NwObject;
    fn nw_proxy_config_set_failover_allowed(proxy_config: NwObject, allowed: bool);
    fn nw_privacy_context_add_proxy(privacy_context: NwObject, proxy_config: NwObject);
    fn nw_release(obj: NwObject);
}

/// Points every Network.framework connection in the process at an HTTP CONNECT proxy on
/// `127.0.0.1:port`, as a system proxy would.
fn set_process_proxy(port: u16) {
    let host = CString::new("127.0.0.1").unwrap();
    let port = CString::new(port.to_string()).unwrap();
    // SAFETY: each object created here is released once, after the context retains it.
    unsafe {
        let endpoint = nw_endpoint_create_host(host.as_ptr(), port.as_ptr());
        let config = nw_proxy_config_create_http_connect(endpoint, std::ptr::null_mut());
        nw_proxy_config_set_failover_allowed(config, true);
        nw_privacy_context_add_proxy(_nw_privacy_context_default_context, config);
        nw_release(config);
        nw_release(endpoint);
    }
}

async fn read_head(stream: &mut (impl AsyncReadExt + Unpin)) -> String {
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        head.push(stream.read_u8().await.unwrap());
    }
    String::from_utf8(head).unwrap()
}

/// A host the engine passes through is tunneled as soon as its `CONNECT` arrives. When that
/// `CONNECT` is the engine's own upstream falling back to the proxy, tunneling it out again would
/// fall back again, without end. One `CONNECT`, then the client gets a 502.
#[tokio::test(flavor = "multi_thread")]
async fn own_fallback_through_a_passthrough_host_stops() {
    const TARGET: &str = "yaak-proxy-own-fallback.invalid";
    let dir = TempDir::new().unwrap();
    let ca = Arc::new(CaStore::load_or_create(dir.path()).unwrap());
    let proxy = start_proxy(ProxyConfig::new(0, ca)).unwrap();
    let engine_port = proxy.port;

    // Counts the CONNECTs on their way from Network.framework to the engine.
    let gateway = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_port = gateway.local_addr().unwrap().port();
    let connects = Arc::new(AtomicUsize::new(0));
    let seen = connects.clone();
    tokio::spawn(async move {
        loop {
            let (mut inbound, _) = gateway.accept().await.unwrap();
            let seen = seen.clone();
            tokio::spawn(async move {
                let head = read_head(&mut inbound).await;
                if head.starts_with("CONNECT ") {
                    seen.fetch_add(1, Ordering::SeqCst);
                }
                let mut engine = TcpStream::connect(("127.0.0.1", engine_port)).await.unwrap();
                engine.write_all(head.as_bytes()).await.unwrap();
                let _ = copy_bidirectional(&mut inbound, &mut engine).await;
            });
        }
    });
    set_process_proxy(gateway_port);

    // A client that rejects the engine's certificate gets the target passed through.
    let mut tcp = TcpStream::connect(("127.0.0.1", engine_port)).await.unwrap();
    let connect = format!("CONNECT {TARGET}:80 HTTP/1.1\r\nHost: {TARGET}:80\r\n\r\n");
    tcp.write_all(connect.as_bytes()).await.unwrap();
    assert!(read_head(&mut tcp).await.starts_with("HTTP/1.1 200"));
    let distrusting =
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(RootCertStore::empty())
            .with_no_client_auth();
    let name = ServerName::try_from(TARGET).unwrap();
    assert!(TlsConnector::from(Arc::new(distrusting)).connect(name, tcp).await.is_err());
    let addr = format!("{TARGET}:80");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while proxy.handshake_state(&addr) != (0, true) {
        assert!(tokio::time::Instant::now() < deadline, "{addr} was never passed through");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let mut client = TcpStream::connect(("127.0.0.1", engine_port)).await.unwrap();
    let request = format!("GET http://{TARGET}/ HTTP/1.1\r\nHost: {TARGET}\r\n\r\n");
    client.write_all(request.as_bytes()).await.unwrap();
    let head = tokio::time::timeout(Duration::from_secs(10), read_head(&mut client))
        .await
        .expect("no response");
    assert!(head.starts_with("HTTP/1.1 502"), "{head}");

    // Give a runaway chain time to show.
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(connects.load(Ordering::SeqCst), 1);
}
