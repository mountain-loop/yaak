use axum::extract::rejection::BytesRejection;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Json, Response};
use bytes::Bytes;
use serde::de::DeserializeOwned;
use serde_json::json;

pub type ApiResult<T> = Result<T, ApiError>;

pub struct ApiError {
    status: StatusCode,
    message: String,
    challenge: Option<&'static str>,
}

impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self { status, message: message.into(), challenge: None }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }

    /// `challenge` becomes the `WWW-Authenticate` header.
    pub fn unauthorized(message: impl Into<String>, challenge: Option<&'static str>) -> Self {
        Self { status: StatusCode::UNAUTHORIZED, message: message.into(), challenge }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut res = (self.status, Json(json!({ "error": self.message }))).into_response();
        if let Some(challenge) = self.challenge {
            res.headers_mut().insert(header::WWW_AUTHENTICATE, HeaderValue::from_static(challenge));
        }
        res
    }
}

pub fn parse_id(raw: &str, noun: &str) -> ApiResult<u64> {
    raw.parse().map_err(|_| ApiError::not_found(format!("No {noun} with ID {raw}")))
}

/// Taken as a `Result` so an oversized body gets a JSON error like everything else.
pub fn parse_json<T: DeserializeOwned>(body: Result<Bytes, BytesRejection>) -> ApiResult<T> {
    let body = body.map_err(|e| ApiError::new(e.status(), e.body_text()))?;
    if body.is_empty() {
        return Err(ApiError::bad_request("Request body must be JSON"));
    }
    serde_json::from_slice(&body)
        .map_err(|e| ApiError::bad_request(format!("Request body is not valid: {e}")))
}
