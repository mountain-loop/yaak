use mime_guess::{Mime, mime};
use std::path::Path;
use std::str::FromStr;
use tokio::fs;

pub async fn read_response_body(body_path: impl AsRef<Path>, content_type: &str) -> Option<String> {
    let body = fs::read(body_path).await.ok()?;
    let body_charset = parse_charset(content_type).unwrap_or("utf-8".to_string());
    if let Some(decoder) = charset::Charset::for_label(body_charset.as_bytes()) {
        let (cow, _real_encoding, _exist_replace) = decoder.decode(&body);
        return cow.into_owned().into();
    }

    Some(String::from_utf8_lossy(&body).to_string())
}

fn parse_charset(content_type: &str) -> Option<String> {
    let mime: Mime = Mime::from_str(content_type).ok()?;
    mime.get_param(mime::CHARSET).map(|v| v.to_string())
}
