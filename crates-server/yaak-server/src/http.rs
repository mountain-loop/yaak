//! The front door: one HTTP surface for the browser tab.
//!
//! Three routes carry everything. `POST /rpc` is the yaak-rpc envelope, byte for
//! byte what the desktop puts inside Tauri's `invoke`. `GET /events` is the
//! WebSocket that replaces window events, in both directions. And
//! `GET /responses/:id/body` replaces reading `bodyPath` off disk, which a tab
//! cannot do.

use crate::events::EventFrame;
use crate::rpc::BridgeCtx;
use crate::session::SessionContext;
use crate::state::BridgeState;
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tower_http::cors::CorsLayer;
use yaak_rpc::{RpcRequest, RpcResponse, RpcRouter};

#[derive(Clone)]
pub struct AppState {
    pub state: Arc<BridgeState>,
    pub router: Arc<RpcRouter<BridgeCtx>>,
}

pub fn build_app(state: Arc<BridgeState>, router: Arc<RpcRouter<BridgeCtx>>) -> Router {
    let app_state = AppState { state: state.clone(), router };

    let api = Router::new()
        .route("/bridge/info", get(bridge_info))
        .route("/rpc", post(rpc_handler))
        .route("/events", get(events_handler))
        .route("/responses/:id/body", get(response_body))
        .layer(axum::middleware::from_fn_with_state(state.clone(), require_token))
        // The dev setup serves the frontend from Vite on another port, so the
        // tab's origin is not the bridge's. Credentials never ride on cookies
        // here — the token is explicit — so a permissive CORS layer is safe and
        // is bounded by the token check that runs before it.
        .layer(CorsLayer::permissive())
        .with_state(app_state);

    match std::env::var("YAAK_BRIDGE_WEB_DIR").ok() {
        // Serving the built frontend makes the bridge a single process to run.
        // `index.html` is the fallback because the router owns the paths.
        Some(dir) => api.fallback_service(
            tower_http::services::ServeDir::new(&dir)
                .fallback(tower_http::services::ServeFile::new(format!("{dir}/index.html"))),
        ),
        None => api,
    }
}

// -- Auth --

#[derive(Debug, Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

/// Dev-grade bearer check on every route.
///
/// The header is the normal path. The query parameter exists because two of
/// these are opened by the browser itself — the WebSocket and the `<img src>`
/// pointing at a response body — and neither lets the page set headers.
///
/// This is the seam where OTP pairing and per-session keys go. It is not one
/// today: the token is a process-lifetime shared secret, and anything that can
/// read the tab's URL can read it.
async fn require_token(
    State(state): State<Arc<BridgeState>>,
    request: Request,
    next: Next,
) -> Response {
    let from_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|v| v.to_string());

    let from_query = request
        .uri()
        .query()
        .and_then(|q| serde_urlencoded::from_str::<TokenQuery>(q).ok())
        .and_then(|q| q.token);

    let presented = from_header.or(from_query);

    match presented {
        Some(token) if constant_time_eq(&token, &state.token) => next.run(request).await,
        _ => (StatusCode::UNAUTHORIZED, "Invalid or missing bridge token").into_response(),
    }
}

/// Compares without returning early on the first differing byte, so a caller
/// can't learn the token one character at a time.
fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

// -- Routes --

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeInfo {
    name: String,
    version: String,
    capabilities: crate::state::BridgeCapabilities,
    /// Commands this build implements. The browser host uses it to fail fast
    /// with a clear message instead of waiting for a round trip.
    commands: Vec<String>,
}

async fn bridge_info(State(app): State<AppState>) -> Json<BridgeInfo> {
    Json(BridgeInfo {
        name: "Yaak Bridge".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        capabilities: app.state.capabilities.clone(),
        commands: crate::rpc::implemented_commands(&app.router),
    })
}

/// One envelope in, one out. Errors are carried inside the envelope, not as an
/// HTTP status, so the browser host can reject the caller's promise with the
/// backend's own message.
async fn rpc_handler(
    State(app): State<AppState>,
    Json(req): Json<RpcRequest>,
) -> Json<RpcResponse> {
    let ctx = BridgeCtx { state: app.state.clone(), session: app.state.session.get() };
    log::debug!("RPC {}", req.cmd);
    let response = app.router.handle(req, &ctx).await;
    if let RpcResponse::Error { error, .. } = &response {
        log::warn!("RPC failed: {error}");
    }
    Json(response)
}

async fn events_handler(State(app): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| handle_events_socket(socket, app))
}

/// The tab's first frame reports who and where it is; everything after that is
/// a reply to something the server asked.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachPayload {
    label: String,
    url: String,
}

async fn handle_events_socket(socket: WebSocket, app: AppState) {
    use futures::{SinkExt, StreamExt};

    let (mut sink, mut stream) = socket.split();
    let mut outbound = app.state.events.subscribe();

    // Server to client.
    let send_task = tokio::spawn(async move {
        loop {
            match outbound.recv().await {
                Ok(frame) => {
                    let Ok(text) = serde_json::to_string(&frame) else {
                        continue;
                    };
                    if sink.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
                // A tab that fell behind has missed writes, and the model store
                // would be silently stale. Close instead, so a reconnect
                // re-reads the workspace from scratch.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    log::warn!("Events client lagged by {n} frames; closing so it resyncs");
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Client to server.
    let state = app.state.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(message)) = stream.next().await {
            let Message::Text(text) = message else {
                continue;
            };
            let Ok(frame) = serde_json::from_str::<EventFrame>(&text) else {
                log::warn!("Ignoring malformed event frame from browser");
                continue;
            };

            // `bridge_attach` is the browser telling us what the desktop would
            // have read off the window: its label and its current URL.
            if frame.event == "bridge_attach" {
                match serde_json::from_value::<AttachPayload>(frame.payload.clone()) {
                    Ok(attach) => {
                        log::info!("Browser attached: {} at {}", attach.label, attach.url);
                        state.session.set(SessionContext {
                            label: attach.label,
                            url: attach.url,
                        });
                    }
                    Err(e) => log::warn!("Bad bridge_attach payload: {e}"),
                }
                continue;
            }

            state.events.dispatch_inbound(frame);
        }
    });

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }
}

#[derive(Debug, Deserialize)]
struct BodyQuery {
    /// Present so the shared token extractor doesn't reject the request; the
    /// value itself is checked in the middleware.
    #[allow(dead_code)]
    token: Option<String>,
}

/// Stream a response body, with Range support.
///
/// Keyed by response id rather than by path: the tab hands back a `bodyPath`
/// the backend gave it, and resolving that through the database means this
/// route can only ever serve a file the engine wrote, not an arbitrary path a
/// page asked for. Range matters because the video and audio viewers seek.
async fn response_body(
    State(app): State<AppState>,
    Path(id): Path<String>,
    Query(_q): Query<BodyQuery>,
    headers: HeaderMap,
) -> Response {
    let response = match app.state.db().get_http_response(&id) {
        Ok(response) => response,
        Err(_) => return (StatusCode::NOT_FOUND, "No such response").into_response(),
    };

    let Some(body_path) = response.body_path else {
        return (StatusCode::NOT_FOUND, "Response has no body").into_response();
    };

    let mut file = match tokio::fs::File::open(&body_path).await {
        Ok(file) => file,
        Err(e) => return (StatusCode::NOT_FOUND, format!("Body unavailable: {e}")).into_response(),
    };

    let total = match file.metadata().await {
        Ok(meta) => meta.len(),
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("Body unreadable: {e}"))
                .into_response();
        }
    };

    let content_type = response
        .headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case("content-type"))
        .map(|h| h.value.clone())
        .unwrap_or_else(|| "application/octet-stream".to_string());

    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(parse_range);

    let (start, end, status) = match range {
        Some((start, end)) => {
            let end = end.unwrap_or(total.saturating_sub(1)).min(total.saturating_sub(1));
            if total == 0 || start > end {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                    .body(Body::empty())
                    .unwrap();
            }
            (start, end, StatusCode::PARTIAL_CONTENT)
        }
        None => (0, total.saturating_sub(1), StatusCode::OK),
    };

    let length = if total == 0 { 0 } else { end - start + 1 };

    if file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to seek body").into_response();
    }

    let mut buf = vec![0u8; length as usize];
    if let Err(e) = file.read_exact(&mut buf).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read body: {e}"))
            .into_response();
    }

    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, length);

    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"));
    }

    builder.body(Body::from(buf)).unwrap()
}

/// Parses a single `bytes=start-end` range. Multi-range requests are not
/// answered as multipart; the first range is used, which browsers accept.
fn parse_range(value: &str) -> Option<(u64, Option<u64>)> {
    let spec = value.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start, end) = spec.split_once('-')?;
    if start.is_empty() {
        return None;
    }
    let start: u64 = start.parse().ok()?;
    let end = if end.is_empty() { None } else { Some(end.parse().ok()?) };
    Some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ranges() {
        assert_eq!(parse_range("bytes=0-499"), Some((0, Some(499))));
        assert_eq!(parse_range("bytes=500-"), Some((500, None)));
        assert_eq!(parse_range("bytes=0-99,200-299"), Some((0, Some(99))));
        // Suffix ranges ("last 500 bytes") aren't supported; callers get the
        // whole body, which is correct if wasteful.
        assert_eq!(parse_range("bytes=-500"), None);
        assert_eq!(parse_range("nonsense"), None);
    }

    #[test]
    fn token_comparison_requires_exact_match() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "abcd"));
    }
}
