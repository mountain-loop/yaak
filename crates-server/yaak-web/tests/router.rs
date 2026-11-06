use axum::body::{Body, to_bytes};
use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use std::path::PathBuf;
use tower::ServiceExt;
use yaak_web::{Config, router};

fn config(serve: Option<PathBuf>) -> Config {
    Config {
        host: "127.0.0.1".to_string(),
        port: 0,
        app_port: None,
        serve,
        allow_private_networks: false,
        allowed_origins: vec!["*".into()],
        max_request_bytes: 1024,
        max_response_bytes: 2048,
        max_timeout_secs: 5,
        rate_limit_per_minute: 10,
        max_concurrent: 2,
        trust_forwarded_for: false,
    }
}

async fn mark_response(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert("x-hosted-middleware", HeaderValue::from_static("yes"));
    response
}

#[tokio::test]
async fn embedded_router_serves_api_without_static_files() {
    let app = router(config(None)).layer(middleware::from_fn(mark_response));
    let response = app
        .clone()
        .oneshot(Request::builder().uri("/v1/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["x-hosted-middleware"], "yes");
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    let health: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(health["ok"], true);
    assert_eq!(health["maxResponseBytes"], 2048);
    assert_eq!(health["maxTimeoutSecs"], 5);

    let response = app.oneshot(Request::new(Body::empty())).await.unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn middleware_wraps_html_fallback_and_assets_alongside_api() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "<html>Yaak</html>").unwrap();
    std::fs::create_dir(dir.path().join("assets")).unwrap();
    std::fs::write(dir.path().join("assets/app-abc.js"), "// app").unwrap();
    let app = router(config(Some(dir.path().into()))).layer(middleware::from_fn(mark_response));

    for path in [
        "/",
        "/workspace/example",
        "/assets/app-abc.js",
        "/v1/health",
    ] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(response.headers()["x-hosted-middleware"], "yes", "{path}");
        if path.starts_with("/assets/") {
            assert_eq!(
                response.headers()[header::CACHE_CONTROL],
                "public, max-age=31536000, immutable"
            );
        } else if path == "/v1/health" {
            assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
        } else {
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-cache");
            assert!(
                response.headers()[header::CONTENT_TYPE].to_str().unwrap().starts_with("text/html")
            );
            assert_eq!(to_bytes(response.into_body(), 4096).await.unwrap(), "<html>Yaak</html>");
        }
    }
}
