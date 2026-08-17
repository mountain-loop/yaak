//! yaak-send-proxy: the network half of Yaak in a browser.
//!
//! A tab can't see a response the way a desktop app can — CORS hides most
//! headers, redirects are followed silently, there is no timeline. So the tab
//! renders the request and hands it here; this process puts it on the network
//! with the desktop's own engine and streams back everything that happened,
//! for the tab to store. It keeps nothing: no database, no files, no session.
//!
//! One binary, configured by flags or `YAAK_PROXY_*` environment variables.
//! See README.md for running and self-hosting it, and `guard.rs` for what it
//! refuses to talk to.

mod config;
mod guard;
mod limits;
mod send;
mod wire;

use axum::Router;
use axum::body::Body;
use axum::extract::{ConnectInfo, DefaultBodyLimit, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{get, post};
use clap::Parser;
use config::Config;
use guard::DestinationPolicy;
use limits::RateLimiter;
use log::{info, warn};
use send::{Refusal, SendLimits};
use serde_json::json;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;
use tower_http::cors::{AllowOrigin, CorsLayer};
use wire::SendRequest;

#[derive(Clone)]
struct AppState {
    config: Arc<Config>,
    limits: Arc<SendLimits>,
    rate_limiter: Arc<RateLimiter>,
    in_flight: Arc<Semaphore>,
}

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let config = Config::parse();

    let policy = DestinationPolicy;
    let state = AppState {
        limits: Arc::new(SendLimits {
            policy,
            max_response_bytes: config.max_response_bytes,
            max_timeout: Duration::from_secs(config.max_timeout_secs),
        }),
        rate_limiter: Arc::new(RateLimiter::new(config.rate_limit_per_minute)),
        in_flight: Arc::new(Semaphore::new(config.max_concurrent)),
        config: Arc::new(config),
    };

    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE])
        .allow_origin(allowed_origins(&state.config.allowed_origins));

    let app = Router::new()
        .route("/v1/health", get(health))
        // A WebSocket or gRPC relay would sit beside this as `/v1/ws/relay` and `/v1/grpc/relay`
        // on the same router, behind the same policy, limits and auth. Not built; see README.
        .route("/v1/http/send", post(send_http))
        .layer(DefaultBodyLimit::max(state.config.max_request_bytes))
        .layer(cors)
        .with_state(state.clone());

    let bind = state.config.bind;
    let listener = tokio::net::TcpListener::bind(bind).await.unwrap_or_else(|e| {
        eprintln!("Failed to bind {bind}: {e}");
        std::process::exit(1);
    });
    info!(
        "yaak-send-proxy listening on http://{bind} (rate limit: {}/min)",
        state.config.rate_limit_per_minute,
    );

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
            info!("Shutting down");
        })
        .await
        .expect("server error");
}

fn allowed_origins(origins: &[String]) -> AllowOrigin {
    if origins.iter().any(|o| o.trim() == "*") {
        return AllowOrigin::any();
    }
    let parsed: Vec<HeaderValue> =
        origins.iter().filter_map(|o| HeaderValue::from_str(o.trim()).ok()).collect();
    AllowOrigin::list(parsed)
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    Json(json!({
        "ok": true,
        "version": env!("CARGO_PKG_VERSION"),
        "maxResponseBytes": state.config.max_response_bytes,
        "maxTimeoutSecs": state.config.max_timeout_secs,
    }))
}

fn error_response(status: StatusCode, message: impl Into<String>) -> Response {
    let message = message.into();
    (status, Json(json!({ "error": message }))).into_response()
}

/// The client's address for rate limiting: the socket peer, or the first `X-Forwarded-For`
/// hop when the operator has said the header can be trusted.
fn client_ip(config: &Config, headers: &HeaderMap, peer: SocketAddr) -> IpAddr {
    if config.trust_forwarded_for
        && let Some(forwarded) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok())
        && let Some(first) = forwarded.split(',').next()
        && let Ok(ip) = first.trim().parse::<IpAddr>()
    {
        return ip;
    }
    peer.ip()
}

async fn send_http(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<SendRequest>,
) -> Response {
    let ip = client_ip(&state.config, &headers, peer);
    if let Err(wait) = state.rate_limiter.check(ip) {
        warn!("Rate limited {ip}");
        let mut res = error_response(
            StatusCode::TOO_MANY_REQUESTS,
            format!("Rate limit reached; try again in {}s", wait.as_secs().max(1)),
        );
        res.headers_mut().insert(header::RETRY_AFTER, HeaderValue::from(wait.as_secs().max(1)));
        return res;
    }

    let Ok(permit) = state.in_flight.clone().try_acquire_owned() else {
        warn!("At capacity; refusing {ip}");
        return error_response(StatusCode::SERVICE_UNAVAILABLE, "This proxy is at capacity");
    };

    let prepared = match send::prepare(state.limits.clone(), body).await {
        Ok(p) => p,
        Err(Refusal::Unsupported(m)) => return error_response(StatusCode::BAD_REQUEST, m),
        Err(Refusal::Invalid(m)) => return error_response(StatusCode::BAD_REQUEST, m),
        Err(Refusal::Destination(m)) => {
            warn!("Refused send from {ip}: {m}");
            return error_response(StatusCode::FORBIDDEN, m);
        }
    };

    let description = prepared.describe();
    info!("{ip} -> {description}");
    let started = Instant::now();

    let (tx, rx) = tokio::sync::mpsc::channel(send::FRAME_CHANNEL_CAPACITY);
    tokio::spawn(async move {
        prepared.run(tx).await;
        send::log_outcome(&description, started, "finished");
        drop(permit);
    });

    let stream = tokio_stream_from(rx);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-ndjson")
        .header(header::CACHE_CONTROL, "no-store")
        // Some reverse proxies buffer streamed responses unless told not to
        .header("x-accel-buffering", "no")
        .body(Body::from_stream(stream))
        .expect("valid response")
}

fn tokio_stream_from<T: Send + 'static>(
    mut rx: tokio::sync::mpsc::Receiver<T>,
) -> impl futures_util::Stream<Item = T> + Send + 'static {
    futures_util::stream::poll_fn(move |cx| rx.poll_recv(cx))
}
