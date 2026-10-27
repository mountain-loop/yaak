//! HAR 1.2 export (http://www.softwareishard.com/blog/har-12-spec/). Bodies are decoded with
//! their Content-Encoding; one that is not UTF-8 is written in base64 with `encoding: "base64"`.
//! Fields the spec leaves to the exporter start with an underscore: `_truncated` on a body cut
//! at the capture limit and `_error` on a flow that failed.

use crate::bodies::{self, DecodedBody};
use crate::flows::{BodyEncoding, BodyPreview};
use crate::models::{Flow, FlowBody, ProxyHeader, find_header};
use serde::{Deserialize, Serialize};
use yaak_models::blob_manager::BlobManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Har {
    pub log: HarLog,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HarLog {
    pub version: String,
    pub creator: HarCreator,
    pub entries: Vec<HarEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HarCreator {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarEntry {
    pub started_date_time: String,
    pub time: i64,
    pub request: HarRequest,
    pub response: HarResponse,
    pub cache: serde_json::Map<String, serde_json::Value>,
    pub timings: HarTimings,
    #[serde(rename = "serverIPAddress", skip_serializing_if = "Option::is_none")]
    pub server_ip_address: Option<String>,
    #[serde(rename = "_error", skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarRequest {
    pub method: String,
    pub url: String,
    pub http_version: String,
    pub cookies: Vec<HarNameValue>,
    pub headers: Vec<HarNameValue>,
    pub query_string: Vec<HarNameValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_data: Option<HarPostData>,
    pub headers_size: i64,
    pub body_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarResponse {
    pub status: i32,
    pub status_text: String,
    pub http_version: String,
    pub cookies: Vec<HarNameValue>,
    pub headers: Vec<HarNameValue>,
    pub content: HarContent,
    #[serde(rename = "redirectURL")]
    pub redirect_url: String,
    pub headers_size: i64,
    pub body_size: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarNameValue {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarPostData {
    pub mime_type: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<String>,
    #[serde(
        rename = "_truncated",
        skip_serializing_if = "std::ops::Not::not",
        default
    )]
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarContent {
    pub size: i64,
    pub mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<String>,
    #[serde(
        rename = "_truncated",
        skip_serializing_if = "std::ops::Not::not",
        default
    )]
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HarTimings {
    pub send: i64,
    pub wait: i64,
    pub receive: i64,
}

/// A HAR of `flows`, reading each body from `blobs` and keeping at most `limit` bytes of it.
pub async fn export(blobs: &BlobManager, flows: &[Flow], limit: usize) -> Result<Har, String> {
    let mut entries = Vec::with_capacity(flows.len());
    for flow in flows {
        let request = bodies::read_body(blobs, flow, FlowBody::Request, limit).await?;
        let response = bodies::read_body(blobs, flow, FlowBody::Response, limit).await?;
        entries.push(entry(flow, &request, &response));
    }
    Ok(har(entries))
}

pub fn har(entries: Vec<HarEntry>) -> Har {
    Har {
        log: HarLog {
            version: "1.2".into(),
            creator: HarCreator {
                name: "Yaak Proxy".into(),
                version: env!("CARGO_PKG_VERSION").into(),
            },
            entries,
        },
    }
}

pub fn entry(flow: &Flow, request_body: &DecodedBody, response_body: &DecodedBody) -> HarEntry {
    let elapsed = flow.elapsed_ms.map_or(0, i64::from).max(0);
    let wait = flow.elapsed_headers_ms.map_or(elapsed, i64::from).clamp(0, elapsed);
    let responded = flow.status.is_some();

    HarEntry {
        started_date_time: flow.started_at.and_utc().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        time: elapsed,
        request: HarRequest {
            method: flow.method.clone(),
            url: flow.url.clone(),
            http_version: flow.client_http_version.clone(),
            cookies: Vec::new(),
            headers: name_values(&flow.request_headers),
            query_string: query_string(&flow.url),
            post_data: post_data(flow, request_body),
            headers_size: -1,
            body_size: flow.request_size,
        },
        response: HarResponse {
            status: flow.status.unwrap_or(0),
            status_text: flow
                .status
                .and_then(|s| hyper::StatusCode::from_u16(u16::try_from(s).ok()?).ok())
                .and_then(|s| s.canonical_reason())
                .unwrap_or_default()
                .to_string(),
            http_version: flow.upstream_http_version.clone().unwrap_or_default(),
            cookies: Vec::new(),
            headers: name_values(&flow.response_headers),
            content: content(flow, response_body),
            redirect_url: find_header(&flow.response_headers, "location")
                .unwrap_or_default()
                .to_string(),
            headers_size: -1,
            body_size: if responded { flow.response_size } else { -1 },
        },
        cache: Default::default(),
        timings: HarTimings { send: 0, wait, receive: elapsed - wait },
        server_ip_address: flow.remote_addr.as_deref().map(ip_of),
        error: flow
            .error
            .clone()
            .or_else(|| response_body.decode_error.clone())
            .or_else(|| request_body.decode_error.clone()),
    }
}

fn name_values(headers: &[ProxyHeader]) -> Vec<HarNameValue> {
    headers.iter().map(|h| HarNameValue { name: h.name.clone(), value: h.value.clone() }).collect()
}

fn query_string(url: &str) -> Vec<HarNameValue> {
    let Some((_, query)) = url.split_once('?') else {
        return Vec::new();
    };
    let query = query.split('#').next().unwrap_or_default();
    url::form_urlencoded::parse(query.as_bytes())
        .map(|(name, value)| HarNameValue { name: name.into_owned(), value: value.into_owned() })
        .collect()
}

fn post_data(flow: &Flow, body: &DecodedBody) -> Option<HarPostData> {
    if body.data.is_empty() && !body.truncated {
        return None;
    }
    let preview = BodyPreview::new(&body.data, body.truncated);
    Some(HarPostData {
        mime_type: find_header(&flow.request_headers, "content-type").unwrap_or_default().into(),
        encoding: base64_marker(preview.encoding),
        text: preview.data,
        truncated: body.truncated,
    })
}

fn content(flow: &Flow, body: &DecodedBody) -> HarContent {
    let mime_type = find_header(&flow.response_headers, "content-type").unwrap_or_default().into();
    if body.data.is_empty() && !body.truncated {
        return HarContent { size: 0, mime_type, text: None, encoding: None, truncated: false };
    }
    let preview = BodyPreview::new(&body.data, body.truncated);
    HarContent {
        size: body.data.len() as i64,
        mime_type,
        encoding: base64_marker(preview.encoding),
        text: Some(preview.data),
        truncated: body.truncated,
    }
}

fn base64_marker(encoding: BodyEncoding) -> Option<String> {
    (encoding == BodyEncoding::Base64).then(|| "base64".to_string())
}

/// The address without its port: `127.0.0.1:443` to `127.0.0.1`, `[::1]:443` to `::1`.
fn ip_of(addr: &str) -> String {
    match addr.parse::<std::net::SocketAddr>() {
        Ok(a) => a.ip().to_string(),
        Err(_) => addr.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    const GOLDEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/export.har");

    fn header(name: &str, value: &str) -> ProxyHeader {
        ProxyHeader { name: name.into(), value: value.into() }
    }

    fn body(data: &[u8], truncated: bool) -> DecodedBody {
        DecodedBody { data: data.to_vec(), stored_size: data.len(), truncated, decode_error: None }
    }

    fn at(second: u32) -> chrono::NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 10, 26)
            .unwrap()
            .and_hms_milli_opt(9, 30, second, 250)
            .unwrap()
    }

    fn flows() -> Vec<(Flow, DecodedBody, DecodedBody)> {
        let json = Flow {
            id: "fl_json".into(),
            started_at: at(1),
            method: "GET".into(),
            url:
                "https://api.github.com/repos/mountain-loop/yaak/issues?state=open&labels=bug%20fix"
                    .into(),
            client_http_version: "HTTP/1.1".into(),
            upstream_http_version: Some("HTTP/2".into()),
            remote_addr: Some("140.82.112.6:443".into()),
            status: Some(200),
            content_type: Some("application/json; charset=utf-8".into()),
            request_headers: vec![
                header("Host", "api.github.com"),
                header("Accept", "application/vnd.github+json"),
            ],
            response_headers: vec![
                header("content-type", "application/json; charset=utf-8"),
                header("content-encoding", "gzip"),
            ],
            response_size: 41,
            elapsed_headers_ms: Some(120),
            elapsed_ms: Some(134),
            ..Default::default()
        };
        let form = Flow {
            id: "fl_form".into(),
            started_at: at(2),
            method: "POST".into(),
            url: "http://localhost:3000/login".into(),
            client_http_version: "HTTP/1.1".into(),
            upstream_http_version: Some("HTTP/1.1".into()),
            remote_addr: Some("[::1]:3000".into()),
            status: Some(302),
            request_headers: vec![header("Content-Type", "application/x-www-form-urlencoded")],
            response_headers: vec![header("Location", "/dashboard")],
            request_size: 26,
            elapsed_headers_ms: Some(8),
            elapsed_ms: Some(8),
            ..Default::default()
        };
        let image = Flow {
            id: "fl_image".into(),
            started_at: at(3),
            method: "GET".into(),
            url: "https://images.example.com/logo.png".into(),
            client_http_version: "HTTP/1.1".into(),
            upstream_http_version: Some("HTTP/2".into()),
            status: Some(200),
            response_headers: vec![header("Content-Type", "image/png")],
            response_size: 8,
            elapsed_headers_ms: Some(30),
            elapsed_ms: Some(31),
            ..Default::default()
        };
        let cut = Flow {
            id: "fl_cut".into(),
            started_at: at(4),
            method: "GET".into(),
            url: "https://cdn.example.com/big.txt".into(),
            client_http_version: "HTTP/1.1".into(),
            upstream_http_version: Some("HTTP/1.1".into()),
            status: Some(200),
            response_headers: vec![header("Content-Type", "text/plain")],
            response_size: 20_000_000,
            response_truncated: true,
            elapsed_headers_ms: Some(10),
            elapsed_ms: Some(900),
            error: Some("connection reset by peer".into()),
            ..Default::default()
        };
        let failed = Flow {
            id: "fl_failed".into(),
            started_at: at(5),
            method: "GET".into(),
            url: "https://down.example.com/".into(),
            client_http_version: "HTTP/1.1".into(),
            elapsed_ms: Some(3),
            error: Some("Connection refused (os error 61)".into()),
            ..Default::default()
        };
        vec![
            (json, body(b"", false), body(br#"[{"number":761,"title":"MCP"}]"#, false)),
            (form, body(b"user=greg&password=hunter2", false), body(b"", false)),
            (
                image,
                body(b"", false),
                body(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a], false),
            ),
            (cut, body(b"", false), body(b"0123456789", true)),
            (failed, body(b"", false), body(b"", false)),
        ]
    }

    #[tokio::test]
    async fn export_keeps_a_body_that_fails_to_decode() {
        use std::io::Write;
        use yaak_models::blob_manager::BodyChunkWriter;

        // Text that does not compress to nothing, gzipped, with the stream cut in half.
        let mut seed = 7u32;
        let text: Vec<u8> = (0..8000)
            .map(|_| {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                b'a' + (seed >> 16) as u8 % 26
            })
            .collect();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(&text).unwrap();
        let gz = gz.finish().unwrap();

        let (_db, blobs, _rx) = yaak_models::init_in_memory().unwrap();
        let mut writer =
            BodyChunkWriter::new(blobs.clone(), Flow::body_id("fl_bad", FlowBody::Response));
        writer.write(&gz[..gz.len() / 2]).unwrap();
        writer.finish().unwrap();
        let flow = Flow {
            id: "fl_bad".into(),
            method: "GET".into(),
            url: "https://cdn.example.com/a.txt".into(),
            status: Some(200),
            response_headers: vec![
                header("Content-Type", "text/plain"),
                header("Content-Encoding", "gzip"),
            ],
            ..Default::default()
        };

        let har = export(&blobs, &[flow], 1024 * 1024).await.unwrap();
        let entry = &har.log.entries[0];
        let text_kept = entry.response.content.text.as_deref().unwrap();
        assert!(!text_kept.is_empty() && text.starts_with(text_kept.as_bytes()));
        assert!(entry.response.content.truncated);
        assert!(
            entry.error.as_deref().unwrap().starts_with("Failed to decode"),
            "{:?}",
            entry.error
        );
    }

    #[test]
    fn golden_file() {
        let entries = flows().iter().map(|(f, req, res)| entry(f, req, res)).collect();
        let mut har = har(entries);
        har.log.creator.version = "test".into();
        let actual = serde_json::to_string_pretty(&har).unwrap() + "\n";

        if std::env::var_os("UPDATE_GOLDEN").is_some() {
            std::fs::write(GOLDEN, &actual).unwrap();
        }
        let expected = std::fs::read_to_string(GOLDEN).unwrap();
        assert_eq!(actual, expected, "rerun with UPDATE_GOLDEN=1 to accept a change");
    }
}
