use reqwest::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT};
use serde_json::Value;

pub fn build_client(session_token: Option<&str>) -> Result<Client, String> {
    let mut headers = HeaderMap::new();
    let user_agent = HeaderValue::from_str(&user_agent())
        .map_err(|e| format!("Failed to build user-agent header: {e}"))?;
    headers.insert(USER_AGENT, user_agent);

    if let Some(token) = session_token {
        let token_value = HeaderValue::from_str(token)
            .map_err(|e| format!("Failed to build session header: {e}"))?;
        headers.insert(HeaderName::from_static("x-yaak-session"), token_value);
    }

    Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))
}

pub fn parse_api_error(status: u16, body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        if let Some(message) = value.get("message").and_then(Value::as_str) {
            return message.to_string();
        }
        if let Some(error) = value.get("error").and_then(Value::as_str) {
            return error.to_string();
        }
    }

    format!("API error {status}: {body}")
}

fn user_agent() -> String {
    format!("YaakCli/{} ({})", crate::version::cli_version(), ua_platform())
}

fn ua_platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "Win",
        "darwin" => "Mac",
        "linux" => "Linux",
        _ => "Unknown",
    }
}
