use crate::AppState;
use crate::data::{self, User};
use crate::error::{ApiError, ApiResult, parse_json};
use axum::extract::State;
use axum::extract::rejection::BytesRejection;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Json, Response};
use bytes::Bytes;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const PASSWORD: &str = "yaak";
const SESSION_COOKIE: &str = "session";
const TTL: Duration = Duration::from_secs(60 * 60);
const MAX_CREDENTIALS: usize = 10_000;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Bearer,
    Session,
}

/// Issued tokens and session IDs, kept apart so a token can't be sent as a cookie or the
/// other way around.
pub struct Credentials {
    entries: Mutex<HashMap<String, Entry>>,
}

struct Entry {
    user_id: u64,
    kind: Kind,
    expires: Instant,
}

impl Credentials {
    pub fn new() -> Self {
        Self { entries: Mutex::new(HashMap::new()) }
    }

    fn issue(&self, user_id: u64, kind: Kind) -> String {
        let value = uuid::Uuid::new_v4().simple().to_string();
        let now = Instant::now();
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if entries.len() >= MAX_CREDENTIALS {
            entries.retain(|_, e| e.expires > now);
        }
        if entries.len() >= MAX_CREDENTIALS
            && let Some(oldest) =
                entries.iter().min_by_key(|(_, e)| e.expires).map(|(k, _)| k.clone())
        {
            entries.remove(&oldest);
        }
        entries.insert(value.clone(), Entry { user_id, kind, expires: now + TTL });
        value
    }

    fn lookup(&self, value: &str, kind: Kind) -> Option<&'static User> {
        let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let entry = entries.get(value)?;
        if entry.kind != kind || entry.expires <= Instant::now() {
            return None;
        }
        data::user(entry.user_id)
    }

    fn revoke(&self, value: &str) {
        self.entries.lock().unwrap_or_else(|e| e.into_inner()).remove(value);
    }
}

#[derive(Deserialize)]
struct Login {
    username: String,
    password: String,
}

fn log_in(body: Result<Bytes, BytesRejection>) -> ApiResult<&'static User> {
    let login: Login = parse_json(body)?;
    data::user_by_username(&login.username)
        .filter(|_| login.password == PASSWORD)
        .ok_or_else(|| ApiError::unauthorized("Invalid username or password", None))
}

pub async fn create_token(
    State(state): State<AppState>,
    body: Result<Bytes, BytesRejection>,
) -> ApiResult<Json<Value>> {
    let user = log_in(body)?;
    let token = state.credentials.issue(user.id, Kind::Bearer);
    Ok(Json(json!({
        "accessToken": token,
        "tokenType": "Bearer",
        "expiresIn": TTL.as_secs(),
    })))
}

pub async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<&'static User>> {
    let Some(authorization) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok())
    else {
        return Err(ApiError::unauthorized("Missing Authorization header", Some("Bearer")));
    };
    let token = match authorization.split_once(' ') {
        Some((scheme, token)) if scheme.eq_ignore_ascii_case("bearer") => token.trim(),
        _ => {
            return Err(ApiError::unauthorized(
                "Authorization header must be \"Bearer <token>\"",
                Some("Bearer"),
            ));
        }
    };
    state.credentials.lookup(token, Kind::Bearer).map(Json).ok_or_else(|| {
        ApiError::unauthorized("Invalid or expired token", Some("Bearer error=\"invalid_token\""))
    })
}

pub async fn create_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> ApiResult<Response> {
    let user = log_in(body)?;
    let id = state.credentials.issue(user.id, Kind::Session);
    let cookie = format!(
        "{SESSION_COOKIE}={id}; Path=/; Max-Age={}; HttpOnly; SameSite=Lax{}",
        TTL.as_secs(),
        secure_attribute(&headers)
    );
    let mut res = Json(user).into_response();
    res.headers_mut().insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).expect("ascii"));
    Ok(res)
}

pub async fn session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<&'static User>> {
    let Some(id) = session_cookie(&headers) else {
        return Err(ApiError::unauthorized("Missing session cookie", None));
    };
    state
        .credentials
        .lookup(id, Kind::Session)
        .map(Json)
        .ok_or_else(|| ApiError::unauthorized("Invalid or expired session", None))
}

pub async fn delete_session(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(id) = session_cookie(&headers) {
        state.credentials.revoke(id);
    }
    let cookie = format!(
        "{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax{}",
        secure_attribute(&headers)
    );
    let mut res = StatusCode::NO_CONTENT.into_response();
    res.headers_mut().insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).expect("ascii"));
    res
}

fn session_cookie(headers: &HeaderMap) -> Option<&str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == SESSION_COOKIE)
        .map(|(_, value)| value)
}

/// `Secure` only when the request reached the proxy over HTTPS, so the cookie still works
/// against a local instance on plain HTTP.
fn secure_attribute(headers: &HeaderMap) -> &'static str {
    let https = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("https"));
    if https { "; Secure" } else { "" }
}
