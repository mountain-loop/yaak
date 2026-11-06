//! yaak-web: the network half of Yaak in a browser.
//!
//! A tab can't see a response the way a desktop app can — CORS hides most
//! headers, redirects are followed silently, there is no timeline. So the tab
//! renders the request and hands it here; this process puts it on the network
//! with the desktop's own engine and streams back everything that happened,
//! for the tab to store. It keeps nothing: no database, no files, no session.
//!
//! Embed [`router`] in your own Axum server, or run the `yaak-web` binary
//! configured by flags or `YAAK_WEB_*` environment variables.
//! See README.md for running and deploying it, and `guard.rs` for what it
//! refuses to talk to.

mod config;
mod guard;
mod limits;
mod send;
mod wire;

use axum::Router;
use axum::body::Body;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Json, Redirect, Response};
use axum::routing::{get, post};
pub use config::Config;
use guard::DestinationPolicy;
use limits::RateLimiter;
use log::{debug, info, warn};
use send::{Refusal, SendLimits};
use serde_json::json;
use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use wire::SendRequest;

/// Minimal operational logging; request diagnostics require an explicit `RUST_LOG` setting.
pub const DEFAULT_LOG_FILTER: &str = "warn,yaak_http=error,yaak_web::startup=info";

#[derive(Clone)]
struct AppState {
    config: Arc<Config>,
    limits: Arc<SendLimits>,
    rate_limiter: Arc<RateLimiter>,
    in_flight: Arc<Semaphore>,
}

/// Build the API router and, when configured, the web client's static-file fallback.
///
/// The returned router owns its state and accepts normal Axum middleware via `.layer()`.
/// Construction does not parse arguments, initialize logging, bind a socket, or install
/// shutdown handlers. `config.host` and `config.port` are used only by the standalone binary.
///
/// Serve with `into_make_service_with_connect_info::<SocketAddr>()` so the send endpoint
/// can extract the peer address for rate limiting.
pub fn router(config: Config) -> Router {
    let policy = DestinationPolicy::new(config.allow_private_networks);
    if config.allow_private_networks {
        warn!(
            "Sends to loopback, private and link-local addresses are ALLOWED. Only run this way \
             on an instance strangers cannot reach"
        );
    }
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

    let api = Router::new()
        .route("/v1/health", get(health))
        // A WebSocket or gRPC relay would sit beside this as `/v1/ws/relay` and `/v1/grpc/relay`
        // on the same router, behind the same policy, limits and auth. Not built; see README.
        .route("/v1/http/send", post(send_http))
        .layer(DefaultBodyLimit::max(state.config.max_request_bytes))
        .layer(cors)
        .with_state(state.clone());

    match &state.config.serve {
        Some(dir) => {
            info!("Serving the web client from {}", dir.display());
            api.merge(web_router(dir))
        }
        // Without `--serve` there is no app here, only `/v1`. Someone who opens this
        // port in a browser guessed wrong about which of the two dev servers hosts the
        // app, so send them to the right one when we have been told where it is.
        None => {
            let app_port = state.config.app_port;
            api.fallback(move |headers: HeaderMap| async move { no_app_here(app_port, headers) })
        }
    }
}

/// The built web client, served on the same origin as the API.
///
/// This is what makes a single container zero-configuration: the tab's send URL is a path on
/// the page's own origin, so there is no CORS, no second service and no URL to bake in. It is
/// only a file server — a send behaves exactly as it does without this flag.
///
/// Merged as a fallback, so the `/v1` routes are matched first and a request that matches no
/// file at all gets `index.html` (the app routes client-side; a deep link must survive a
/// refresh).
fn web_router(dir: &Path) -> Router {
    let index = ServeFile::new(dir.join("index.html"));
    Router::new()
        // `fallback`, not `not_found_service`: the app's own routes are real pages, so
        // index.html is served with the 200 the browser expects, not a 404 carrying HTML.
        .fallback_service(ServeDir::new(dir).fallback(index))
        .layer(middleware::from_fn(cache_control))
        .layer(CompressionLayer::new())
}

/// Vite gives everything in `/assets` a content-hashed name, so those can be cached forever.
/// Everything else — `index.html` above all, including the copy served for an unknown path —
/// must be revalidated, or a browser keeps serving the deploy before last.
async fn cache_control(req: Request, next: Next) -> Response {
    let hashed_name = req.uri().path().starts_with("/assets/");
    let mut res = next.run(req).await;
    if !res.status().is_success() {
        return res;
    }
    let is_html = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/html"));
    let value =
        if hashed_name && !is_html { "public, max-age=31536000, immutable" } else { "no-cache" };
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    res
}

/// The name in a `Host` header, without the port this server is reached on.
///
/// An IPv6 literal keeps its brackets and its own colons: the last colon only separates a
/// port when what follows it isn't part of the address, which is what the `]` test decides.
fn host_without_port(host: &str) -> &str {
    match host.rfind(':') {
        Some(i) if !host[i..].contains(']') => &host[..i],
        _ => host,
    }
}

/// What the send executor does with a browser that came looking for the app.
///
/// With an app port configured this is a redirect, built from the `Host` header so the
/// hostname the browser already used is the one it keeps — this server has no idea which of
/// its addresses someone typed, and does not need to.
fn no_app_here(app_port: Option<u16>, headers: HeaderMap) -> Response {
    if let Some(port) = app_port
        && let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok())
    {
        return Redirect::temporary(&format!("http://{}:{port}/", host_without_port(host)))
            .into_response();
    }

    (
        StatusCode::NOT_FOUND,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        "This is the Yaak send executor. It serves the API under /v1 and no app.\n\n\
         To serve the app from here too, restart with --serve <DIR> pointing at a built\n\
         web client.\n",
    )
        .into_response()
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
        debug!("Rate limited {ip}");
        let mut res = error_response(
            StatusCode::TOO_MANY_REQUESTS,
            format!("Rate limit reached; try again in {}s", wait.as_secs().max(1)),
        );
        res.headers_mut().insert(header::RETRY_AFTER, HeaderValue::from(wait.as_secs().max(1)));
        return res;
    }

    let Ok(permit) = state.in_flight.clone().try_acquire_owned() else {
        debug!("At capacity; refusing {ip}");
        return error_response(StatusCode::SERVICE_UNAVAILABLE, "This server is at capacity");
    };

    let prepared = match send::prepare(state.limits.clone(), body).await {
        Ok(p) => p,
        Err(Refusal::Unsupported(m)) => return error_response(StatusCode::BAD_REQUEST, m),
        Err(Refusal::Invalid(m)) => return error_response(StatusCode::BAD_REQUEST, m),
        Err(Refusal::Destination(m)) => {
            debug!("Refused send from {ip}: {m}");
            return error_response(StatusCode::FORBIDDEN, m);
        }
    };

    let description = prepared.describe();
    debug!("{ip} -> {description}");
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

#[cfg(test)]
mod tests {
    use super::host_without_port;

    #[test]
    fn strips_the_port_and_keeps_the_name() {
        assert_eq!(host_without_port("home:9227"), "home");
        assert_eq!(host_without_port("home"), "home");
        assert_eq!(host_without_port("192.168.1.5:9227"), "192.168.1.5");
        assert_eq!(host_without_port("192.168.1.5"), "192.168.1.5");
        // An IPv6 literal is full of colons, and only the one outside the brackets is a port.
        assert_eq!(host_without_port("[::1]:9227"), "[::1]");
        assert_eq!(host_without_port("[::1]"), "[::1]");
        assert_eq!(host_without_port("[2606:4700::1111]:8080"), "[2606:4700::1111]");
        assert_eq!(host_without_port("[2606:4700::1111]"), "[2606:4700::1111]");
    }
}
