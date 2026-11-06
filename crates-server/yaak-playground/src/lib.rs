//! yaak-playground: the API behind yaak.run, for trying Yaak without bringing your own.
//!
//! Reads come from fixed sample data. Writes are kept per client IP and reset after a while,
//! so nothing one caller sends is ever served to another. Nothing touches disk.

mod auth;
mod config;
mod data;
mod error;
mod limits;
mod resources;
mod store;

use axum::Router;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{get, post};
pub use config::Config;
use error::ApiError;
use limits::RateLimiter;
use serde_json::{Value, json};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use store::PostStore;
use tower_http::cors::{AllowOrigin, CorsLayer};

const OPENAPI: &str = include_str!("openapi.json");

#[derive(Clone)]
struct AppState {
    config: Arc<Config>,
    rate_limiter: Arc<RateLimiter>,
    posts: Arc<PostStore>,
    credentials: Arc<auth::Credentials>,
}

#[derive(Clone, Copy)]
struct ClientIp(IpAddr);

/// Serve with `into_make_service_with_connect_info::<SocketAddr>()`; the client's address
/// keys both the rate limit and its private copy of the posts.
pub fn router(config: Config) -> Router {
    let state = AppState {
        rate_limiter: Arc::new(RateLimiter::new(config.rate_limit_per_minute)),
        posts: Arc::new(PostStore::new(
            Duration::from_secs(config.reset_after_secs),
            config.max_clients,
            config.max_posts_per_client,
        )),
        credentials: Arc::new(auth::Credentials::new()),
        config: Arc::new(config),
    };

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::any())
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
        .expose_headers([
            header::LOCATION,
            header::RETRY_AFTER,
            header::WWW_AUTHENTICATE,
        ]);

    Router::new()
        .route("/", get(index))
        .route("/health", get(health))
        .route("/openapi.json", get(openapi))
        .route("/users", get(resources::list_users))
        .route("/users/:id", get(resources::get_user))
        .route("/users/:id/todos", get(resources::list_user_todos))
        .route("/todos", get(resources::list_todos))
        .route("/posts", get(resources::list_posts).post(resources::create_post))
        .route(
            "/posts/:id",
            get(resources::get_post)
                .put(resources::replace_post)
                .patch(resources::update_post)
                .delete(resources::delete_post),
        )
        .route("/auth/token", post(auth::create_token))
        .route("/auth/me", get(auth::me))
        .route(
            "/auth/session",
            post(auth::create_session).get(auth::session).delete(auth::delete_session),
        )
        .fallback(not_found)
        .layer(middleware::from_fn_with_state(state.clone(), identify_client))
        .layer(DefaultBodyLimit::max(state.config.max_request_bytes))
        .layer(cors)
        .with_state(state)
}

async fn identify_client(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    mut req: Request,
    next: Next,
) -> Response {
    let ip = client_ip(&state.config, req.headers(), peer);
    if let Err(wait) = state.rate_limiter.check(ip) {
        let secs = wait.as_secs().max(1);
        let mut res = ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            format!("Rate limit reached. Try again in {secs}s"),
        )
        .into_response();
        res.headers_mut().insert(header::RETRY_AFTER, HeaderValue::from(secs));
        return res;
    }
    req.extensions_mut().insert(ClientIp(ip));
    next.run(req).await
}

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

async fn index(State(state): State<AppState>) -> Json<Value> {
    let spec: Value = serde_json::from_str(OPENAPI).expect("valid openapi.json");
    Json(json!({
        "name": "Yaak Playground",
        "description": "A small API for trying out Yaak. Posts you create, change, or delete are only visible to you, and go back to the sample data after a while.",
        "resetAfterSeconds": state.config.reset_after_secs,
        "login": { "username": "ada", "password": auth::PASSWORD },
        "openapi": "/openapi.json",
        "endpoints": operations(&spec),
    }))
}

/// Every `METHOD /path` the spec documents.
fn operations(spec: &Value) -> Vec<String> {
    let mut ops = Vec::new();
    for (path, item) in spec["paths"].as_object().into_iter().flatten() {
        for method in ["get", "post", "put", "patch", "delete"] {
            if item.get(method).is_some() {
                ops.push(format!("{} {path}", method.to_uppercase()));
            }
        }
    }
    ops
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") }))
}

async fn openapi() -> Response {
    ([(header::CONTENT_TYPE, "application/json")], OPENAPI).into_response()
}

async fn not_found() -> ApiError {
    ApiError::not_found("Not found. GET / lists every endpoint")
}
