/// Integration test to reproduce the HTTP/2 "HTTP/1 specific headers are forbidden" bug.
///
/// Requires a local HTTP/2-only server running on https://localhost:8443
/// Start one with: node h2server.mjs (see tmp dir for the script)
///
/// Run with: cargo test -p yaak-http --test h2_repro -- --nocapture
use reqwest::redirect;
use tokio::sync::mpsc;
use yaak_http::sender::{HttpSender, ReqwestSender};
use yaak_http::types::SendableHttpRequest;
use yaak_tls::get_tls_config;

fn build_yaak_client() -> reqwest::Client {
    let tls_config = get_tls_config(false, true, None).unwrap();
    reqwest::Client::builder()
        .redirect(redirect::Policy::none())
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .referer(false)
        .tls_info(true)
        .pool_max_idle_per_host(0)
        .use_preconfigured_tls(tls_config)
        .build()
        .unwrap()
}

async fn send_and_print(name: &str, request: SendableHttpRequest) {
    println!("\n=== {} ===", name);
    let sender = ReqwestSender::with_client(build_yaak_client());
    let (event_tx, mut event_rx) = mpsc::channel(100);

    let test_name = name.to_string();
    let handle = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            println!("  [{}] {}", test_name, event);
        }
    });

    match sender.send(request, event_tx).await {
        Ok(response) => {
            println!("  [{}] OK: HTTP {} {:?}", name, response.status, response.version);
        }
        Err(e) => {
            println!("  [{}] FAILED: {}", name, e);
        }
    }
    let _ = handle.await;
}

#[tokio::test]
async fn test_h2_post_with_body() {
    // Narrow down: POST with body but no extra headers
    send_and_print("post-body-no-headers", SendableHttpRequest {
        url: "https://localhost:8443/".to_string(),
        method: "POST".to_string(),
        headers: vec![],
        body: Some(yaak_http::types::SendableBody::Bytes(
            bytes::Bytes::from(r#"{"hello":"world"}"#),
        )),
        options: Default::default(),
    }).await;

    // POST with body + content-type only
    send_and_print("post-body-content-type", SendableHttpRequest {
        url: "https://localhost:8443/".to_string(),
        method: "POST".to_string(),
        headers: vec![
            ("Content-Type".to_string(), "application/json".to_string()),
        ],
        body: Some(yaak_http::types::SendableBody::Bytes(
            bytes::Bytes::from(r#"{"hello":"world"}"#),
        )),
        options: Default::default(),
    }).await;

    // POST with body + content-length only
    send_and_print("post-body-content-length", SendableHttpRequest {
        url: "https://localhost:8443/".to_string(),
        method: "POST".to_string(),
        headers: vec![
            ("Content-Length".to_string(), "18".to_string()),
        ],
        body: Some(yaak_http::types::SendableBody::Bytes(
            bytes::Bytes::from(r#"{"hello":"world"}"#),
        )),
        options: Default::default(),
    }).await;

    // POST with body + all typical Yaak headers
    send_and_print("post-body-all-yaak-headers", SendableHttpRequest {
        url: "https://localhost:8443/".to_string(),
        method: "POST".to_string(),
        headers: vec![
            ("Content-Type".to_string(), "application/json".to_string()),
            ("Content-Length".to_string(), "18".to_string()),
            ("User-Agent".to_string(), "yaak".to_string()),
            ("Accept".to_string(), "*/*".to_string()),
        ],
        body: Some(yaak_http::types::SendableBody::Bytes(
            bytes::Bytes::from(r#"{"hello":"world"}"#),
        )),
        options: Default::default(),
    }).await;

    // GET with no body (control — should work)
    send_and_print("get-control", SendableHttpRequest {
        url: "https://localhost:8443/".to_string(),
        method: "GET".to_string(),
        headers: vec![],
        body: None,
        options: Default::default(),
    }).await;
}
