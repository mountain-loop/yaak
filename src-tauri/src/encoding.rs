use tokio::fs;
use std::path::Path;
use log::debug;

pub async fn read_response_body(
    body_path: impl AsRef<Path>,
    cotent_type: &str,
) -> Option<String> {
    let body = fs::read(body_path).await.ok()?;
    let body_charset = parse_charset(cotent_type).unwrap_or("utf-8");
    debug!("body_charset: {}", body_charset);
    if let Some(decoder) = charset::Charset::for_label(body_charset.as_bytes()){
        debug!("Using decoder for charset: {}", body_charset);
        let (cow, real_encoding, exist_replace) = decoder.decode(&body);
        debug!("Decoded body with charset: {}, real_encoding: {:?}, exist_replace: {}", body_charset, real_encoding, exist_replace);
        return cow.into_owned().into();
    }

    Some(String::from_utf8_lossy(&body).to_string())
}

fn parse_charset(content_type: &str) -> Option<&str> {
    content_type
        .split(';')
        .find_map(|part| {
            let part = part.trim();
            if part.starts_with("charset=") {
                Some(&part[8..])
            } else {
                None
            }
        })
}
