use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::{ConnectInfo, Request};
use axum::http::StatusCode;
use axum::routing::get;
use clap::Parser;
use std::io::{self, Write};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;
use yaak_web::{Config, DEFAULT_LOG_FILTER, router};

#[derive(Clone)]
struct LogCapture(Arc<Mutex<Vec<u8>>>);

impl Write for LogCapture {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn send_request(url: &str) -> Request {
    let payload = serde_json::json!({
        "request": { "url": url, "method": "GET" },
        "settings": {
            "validateCertificates": true,
            "followRedirects": true,
            "timeoutMs": 2000,
            "sendCookies": true,
            "storeCookies": true
        }
    });
    Request::builder()
        .method("POST")
        .uri("/v1/http/send")
        .header("content-type", "application/json")
        .extension(ConnectInfo("192.0.2.42:1234".parse::<SocketAddr>().unwrap()))
        .body(Body::from(payload.to_string()))
        .unwrap()
}

#[tokio::test]
async fn default_logging_keeps_operational_warnings_without_request_details() {
    let capture = LogCapture(Arc::new(Mutex::new(Vec::new())));
    env_logger::Builder::new()
        .parse_filters(DEFAULT_LOG_FILTER)
        .target(env_logger::Target::Pipe(Box::new(capture.clone())))
        .init();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let upstream = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route("/private-path", get(|| async { "secret body" })),
        )
        .await
        .unwrap();
    });
    let mut config = Config::parse_from(["yaak-web"]);
    config.allow_private_networks = true;
    config.rate_limit_per_minute = 1;
    let app = router(config.clone());
    assert!(String::from_utf8_lossy(&capture.0.lock().unwrap()).contains("ALLOWED"));
    capture.0.lock().unwrap().clear();

    // Exercise the HTTP engine and DNS lookup as well as the proxy's own logs.
    let url = format!("http://localhost:{port}/private-path?token=secret");
    let response = app.clone().oneshot(send_request(&url)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    assert!(String::from_utf8_lossy(&body).contains("\"type\":\"done\""));
    assert_eq!(
        app.oneshot(send_request(&url)).await.unwrap().status(),
        StatusCode::TOO_MANY_REQUESTS
    );

    config.allow_private_networks = false;
    let app = router(config.clone());
    assert_eq!(
        app.oneshot(send_request("http://127.0.0.1/private-path")).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    config.max_concurrent = 0;
    assert_eq!(
        router(config).oneshot(send_request(&url)).await.unwrap().status(),
        StatusCode::SERVICE_UNAVAILABLE
    );

    upstream.abort();
    let logs = capture.0.lock().unwrap();
    assert!(logs.is_empty(), "Unexpected request logs: {}", String::from_utf8_lossy(&logs));
}
