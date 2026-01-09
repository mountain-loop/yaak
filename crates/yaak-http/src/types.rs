use crate::chained_reader::{ChainedReader, ReaderType};
use crate::error::Error::RequestError;
use crate::error::Result;
use crate::path_placeholders::apply_path_placeholders;
use crate::proto::ensure_proto;
use bytes::Bytes;
use log::warn;
use std::collections::BTreeMap;
use std::pin::Pin;
use std::time::Duration;
use tokio::io::AsyncRead;
use yaak_common::serde::{get_bool, get_str, get_str_map};
use yaak_models::models::HttpRequest;

pub(crate) const MULTIPART_BOUNDARY: &str = "------YaakFormBoundary";

pub enum SendableBody {
    Bytes(Bytes),
    Stream(Pin<Box<dyn AsyncRead + Send + 'static>>),
}

enum SendableBodyWithMeta {
    Bytes(Bytes),
    Stream {
        data: Pin<Box<dyn AsyncRead + Send + 'static>>,
        content_length: Option<usize>,
    },
}

impl From<SendableBodyWithMeta> for SendableBody {
    fn from(value: SendableBodyWithMeta) -> Self {
        match value {
            SendableBodyWithMeta::Bytes(b) => SendableBody::Bytes(b),
            SendableBodyWithMeta::Stream { data, .. } => SendableBody::Stream(data),
        }
    }
}

#[derive(Default)]
pub struct SendableHttpRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<SendableBody>,
    pub options: SendableHttpRequestOptions,
}

#[derive(Default, Clone)]
pub struct SendableHttpRequestOptions {
    pub timeout: Option<Duration>,
    pub follow_redirects: bool,
}

impl SendableHttpRequest {
    pub async fn from_http_request(
        r: &HttpRequest,
        options: SendableHttpRequestOptions,
    ) -> Result<Self> {
        let initial_headers = build_headers(r);
        let (body, headers) = build_body(&r.method, &r.body_type, &r.body, initial_headers).await?;

        Ok(Self {
            url: build_url(r),
            method: r.method.to_uppercase(),
            headers,
            body: body.into(),
            options,
        })
    }

    pub fn insert_header(&mut self, header: (String, String)) {
        if let Some(existing) =
            self.headers.iter_mut().find(|h| h.0.to_lowercase() == header.0.to_lowercase())
        {
            existing.1 = header.1;
        } else {
            self.headers.push(header);
        }
    }
}

pub fn append_query_params(url: &str, params: Vec<(String, String)>) -> String {
    let url_string = url.to_string();
    if params.is_empty() {
        return url.to_string();
    }

    // Build query string
    let query_string = params
        .iter()
        .map(|(name, value)| {
            format!("{}={}", urlencoding::encode(name), urlencoding::encode(value))
        })
        .collect::<Vec<_>>()
        .join("&");

    // Split URL into parts: base URL, query, and fragment
    let (base_and_query, fragment) = if let Some(hash_pos) = url_string.find('#') {
        let (before_hash, after_hash) = url_string.split_at(hash_pos);
        (before_hash.to_string(), Some(after_hash.to_string()))
    } else {
        (url_string, None)
    };

    // Now handle query parameters on the base URL (without fragment)
    let mut result = if base_and_query.contains('?') {
        // Check if there's already a query string after the '?'
        let parts: Vec<&str> = base_and_query.splitn(2, '?').collect();
        if parts.len() == 2 && !parts[1].trim().is_empty() {
            // Append with & if there are existing parameters
            format!("{}&{}", base_and_query, query_string)
        } else {
            // Just append the new parameters directly (URL ends with '?')
            format!("{}{}", base_and_query, query_string)
        }
    } else {
        // No existing query parameters, add with '?'
        format!("{}?{}", base_and_query, query_string)
    };

    // Re-append the fragment if it exists
    if let Some(fragment) = fragment {
        result.push_str(&fragment);
    }

    result
}

fn build_url(r: &HttpRequest) -> String {
    let (url_string, params) = apply_path_placeholders(&ensure_proto(&r.url), &r.url_parameters);
    append_query_params(
        &url_string,
        params
            .iter()
            .filter(|p| p.enabled && !p.name.is_empty())
            .map(|p| (p.name.clone(), p.value.clone()))
            .collect(),
    )
}

fn build_headers(r: &HttpRequest) -> Vec<(String, String)> {
    r.headers
        .iter()
        .filter_map(|h| {
            if h.enabled && !h.name.is_empty() {
                Some((h.name.clone(), h.value.clone()))
            } else {
                None
            }
        })
        .collect()
}

async fn build_body(
    method: &str,
    body_type: &Option<String>,
    body: &BTreeMap<String, serde_json::Value>,
    headers: Vec<(String, String)>,
) -> Result<(Option<SendableBody>, Vec<(String, String)>)> {
    let body_type = match &body_type {
        None => return Ok((None, headers)),
        Some(t) => t,
    };

    let (body, content_type) = match body_type.as_str() {
        "binary" => (build_binary_body(&body).await?, None),
        "graphql" => (build_graphql_body(&method, &body), Some("application/json".to_string())),
        "application/x-www-form-urlencoded" => {
            (build_form_body(&body), Some("application/x-www-form-urlencoded".to_string()))
        }
        "multipart/form-data" => build_multipart_body(&body, &headers).await?,
        _ if body.contains_key("text") => (build_text_body(&body), None),
        t => {
            warn!("Unsupported body type: {}", t);
            (None, None)
        }
    };

    // Add or update the Content-Type header
    let mut headers = headers;
    if let Some(ct) = content_type {
        if let Some(existing) = headers.iter_mut().find(|h| h.0.to_lowercase() == "content-type") {
            existing.1 = ct;
        } else {
            headers.push(("Content-Type".to_string(), ct));
        }
    }

    // Check if Transfer-Encoding: chunked is already set
    let has_chunked_encoding = headers.iter().any(|h| {
        h.0.to_lowercase() == "transfer-encoding" && h.1.to_lowercase().contains("chunked")
    });

    // Add a Content-Length header only if chunked encoding is not being used
    if !has_chunked_encoding {
        let content_length = match body {
            Some(SendableBodyWithMeta::Bytes(ref bytes)) => Some(bytes.len()),
            Some(SendableBodyWithMeta::Stream { content_length, .. }) => content_length,
            None => None,
        };

        if let Some(cl) = content_length {
            headers.push(("Content-Length".to_string(), cl.to_string()));
        }
    }

    Ok((body.map(|b| b.into()), headers))
}

fn build_form_body(body: &BTreeMap<String, serde_json::Value>) -> Option<SendableBodyWithMeta> {
    let form_params = match body.get("form").map(|f| f.as_array()) {
        Some(Some(f)) => f,
        _ => return None,
    };

    let mut body = String::new();
    for p in form_params {
        let enabled = get_bool(p, "enabled", true);
        let name = get_str(p, "name");
        if !enabled || name.is_empty() {
            continue;
        }
        let value = get_str(p, "value");
        if !body.is_empty() {
            body.push('&');
        }
        body.push_str(&urlencoding::encode(&name));
        body.push('=');
        body.push_str(&urlencoding::encode(&value));
    }

    if body.is_empty() { None } else { Some(SendableBodyWithMeta::Bytes(Bytes::from(body))) }
}

async fn build_binary_body(
    body: &BTreeMap<String, serde_json::Value>,
) -> Result<Option<SendableBodyWithMeta>> {
    let file_path = match body.get("filePath").map(|f| f.as_str()) {
        Some(Some(f)) => f,
        _ => return Ok(None),
    };

    // Open a file for streaming
    let content_length = tokio::fs::metadata(file_path)
        .await
        .map_err(|e| RequestError(format!("Failed to get file metadata: {}", e)))?
        .len();

    let file = tokio::fs::File::open(file_path)
        .await
        .map_err(|e| RequestError(format!("Failed to open file: {}", e)))?;

    Ok(Some(SendableBodyWithMeta::Stream {
        data: Box::pin(file),
        content_length: Some(content_length as usize),
    }))
}

fn build_text_body(body: &BTreeMap<String, serde_json::Value>) -> Option<SendableBodyWithMeta> {
    let text = get_str_map(body, "text");
    if text.is_empty() {
        None
    } else {
        Some(SendableBodyWithMeta::Bytes(Bytes::from(text.to_string())))
    }
}

fn build_graphql_body(
    method: &str,
    body: &BTreeMap<String, serde_json::Value>,
) -> Option<SendableBodyWithMeta> {
    let query = get_str_map(body, "query");
    let variables = get_str_map(body, "variables");

    if method.to_lowercase() == "get" {
        // GraphQL GET requests use query parameters, not a body
        return None;
    }

    let body = if variables.trim().is_empty() {
        format!(r#"{{"query":{}}}"#, serde_json::to_string(&query).unwrap_or_default())
    } else {
        format!(
            r#"{{"query":{},"variables":{}}}"#,
            serde_json::to_string(&query).unwrap_or_default(),
            variables
        )
    };

    Some(SendableBodyWithMeta::Bytes(Bytes::from(body)))
}

async fn build_multipart_body(
    body: &BTreeMap<String, serde_json::Value>,
    headers: &Vec<(String, String)>,
) -> Result<(Option<SendableBodyWithMeta>, Option<String>)> {
    let boundary = extract_boundary_from_headers(headers);

    let form_params = match body.get("form").map(|f| f.as_array()) {
        Some(Some(f)) => f,
        _ => return Ok((None, None)),
    };

    // Build a list of readers for streaming and calculate total content length
    let mut readers: Vec<ReaderType> = Vec::new();
    let mut has_content = false;
    let mut total_size: usize = 0;

    for p in form_params {
        let enabled = get_bool(p, "enabled", true);
        let name = get_str(p, "name");
        if !enabled || name.is_empty() {
            continue;
        }

        has_content = true;

        // Add boundary delimiter
        let boundary_bytes = format!("--{}\r\n", boundary).into_bytes();
        total_size += boundary_bytes.len();
        readers.push(ReaderType::Bytes(boundary_bytes));

        let file_path = get_str(p, "file");
        let value = get_str(p, "value");
        let content_type = get_str(p, "contentType");

        if file_path.is_empty() {
            // Text field
            let header = if !content_type.is_empty() {
                format!(
                    "Content-Disposition: form-data; name=\"{}\"\r\nContent-Type: {}\r\n\r\n{}",
                    name, content_type, value
                )
            } else {
                format!("Content-Disposition: form-data; name=\"{}\"\r\n\r\n{}", name, value)
            };
            let header_bytes = header.into_bytes();
            total_size += header_bytes.len();
            readers.push(ReaderType::Bytes(header_bytes));
        } else {
            // File field - validate that file exists first
            if !tokio::fs::try_exists(file_path).await.unwrap_or(false) {
                return Err(RequestError(format!("File not found: {}", file_path)));
            }

            // Get file size for content length calculation
            let file_metadata = tokio::fs::metadata(file_path)
                .await
                .map_err(|e| RequestError(format!("Failed to get file metadata: {}", e)))?;
            let file_size = file_metadata.len() as usize;

            let filename = get_str(p, "filename");
            let filename = if filename.is_empty() {
                std::path::Path::new(file_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("file")
            } else {
                filename
            };

            // Add content type
            let mime_type = if !content_type.is_empty() {
                content_type.to_string()
            } else {
                // Guess mime type from file extension
                mime_guess::from_path(file_path).first_or_octet_stream().to_string()
            };

            let header = format!(
                "Content-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\nContent-Type: {}\r\n\r\n",
                name, filename, mime_type
            );
            let header_bytes = header.into_bytes();
            total_size += header_bytes.len();
            total_size += file_size;
            readers.push(ReaderType::Bytes(header_bytes));

            // Add a file path for streaming
            readers.push(ReaderType::FilePath(file_path.to_string()));
        }

        let line_ending = b"\r\n".to_vec();
        total_size += line_ending.len();
        readers.push(ReaderType::Bytes(line_ending));
    }

    if has_content {
        // Add the final boundary
        let final_boundary = format!("--{}--\r\n", boundary).into_bytes();
        total_size += final_boundary.len();
        readers.push(ReaderType::Bytes(final_boundary));

        let content_type = format!("multipart/form-data; boundary={}", boundary);
        let stream = ChainedReader::new(readers);
        Ok((
            Some(SendableBodyWithMeta::Stream {
                data: Box::pin(stream),
                content_length: Some(total_size),
            }),
            Some(content_type),
        ))
    } else {
        Ok((None, None))
    }
}

fn extract_boundary_from_headers(headers: &Vec<(String, String)>) -> String {
    headers
        .iter()
        .find(|h| h.0.to_lowercase() == "content-type")
        .and_then(|h| {
            // Extract boundary from the Content-Type header (e.g., "multipart/form-data; boundary=xyz")
            h.1.split(';')
                .find(|part| part.trim().starts_with("boundary="))
                .and_then(|boundary_part| boundary_part.split('=').nth(1))
                .map(|b| b.trim().to_string())
        })
        .unwrap_or_else(|| MULTIPART_BOUNDARY.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;
    use serde_json::json;
    use std::collections::BTreeMap;
    use yaak_models::models::{HttpRequest, HttpUrlParameter};

    #[test]
    fn test_build_url_no_params() {
        let r = HttpRequest {
            url: "https://example.com/api".to_string(),
            url_parameters: vec![],
            ..Default::default()
        };

        let result = build_url(&r);
        assert_eq!(result, "https://example.com/api");
    }

    #[test]
    fn test_build_url_with_params() {
        let r = HttpRequest {
            url: "https://example.com/api".to_string(),
            url_parameters: vec![
                HttpUrlParameter {
                    enabled: true,
                    name: "foo".to_string(),
                    value: "bar".to_string(),
                    id: None,
                },
                HttpUrlParameter {
                    enabled: true,
                    name: "baz".to_string(),
                    value: "qux".to_string(),
                    id: None,
                },
            ],
            ..Default::default()
        };

        let result = build_url(&r);
        assert_eq!(result, "https://example.com/api?foo=bar&baz=qux");
    }

    #[test]
    fn test_build_url_with_disabled_params() {
        let r = HttpRequest {
            url: "https://example.com/api".to_string(),
            url_parameters: vec![
                HttpUrlParameter {
                    enabled: false,
                    name: "disabled".to_string(),
                    value: "value".to_string(),
                    id: None,
                },
                HttpUrlParameter {
                    enabled: true,
                    name: "enabled".to_string(),
                    value: "value".to_string(),
                    id: None,
                },
            ],
            ..Default::default()
        };

        let result = build_url(&r);
        assert_eq!(result, "https://example.com/api?enabled=value");
    }

    #[test]
    fn test_build_url_with_existing_query() {
        let r = HttpRequest {
            url: "https://example.com/api?existing=param".to_string(),
            url_parameters: vec![HttpUrlParameter {
                enabled: true,
                name: "new".to_string(),
                value: "value".to_string(),
                id: None,
            }],
            ..Default::default()
        };

        let result = build_url(&r);
        assert_eq!(result, "https://example.com/api?existing=param&new=value");
    }

    #[test]
    fn test_build_url_with_empty_existing_query() {
        let r = HttpRequest {
            url: "https://example.com/api?".to_string(),
            url_parameters: vec![HttpUrlParameter {
                enabled: true,
                name: "new".to_string(),
                value: "value".to_string(),
                id: None,
            }],
            ..Default::default()
        };

        let result = build_url(&r);
        assert_eq!(result, "https://example.com/api?new=value");
    }

    #[test]
    fn test_build_url_with_special_chars() {
        let r = HttpRequest {
            url: "https://example.com/api".to_string(),
            url_parameters: vec![HttpUrlParameter {
                enabled: true,
                name: "special chars!@#".to_string(),
                value: "value with spaces & symbols".to_string(),
                id: None,
            }],
            ..Default::default()
        };

        let result = build_url(&r);
        assert_eq!(
            result,
            "https://example.com/api?special%20chars%21%40%23=value%20with%20spaces%20%26%20symbols"
        );
    }

    #[test]
    fn test_build_url_adds_protocol() {
        let r = HttpRequest {
            url: "example.com/api".to_string(),
            url_parameters: vec![HttpUrlParameter {
                enabled: true,
                name: "foo".to_string(),
                value: "bar".to_string(),
                id: None,
            }],
            ..Default::default()
        };

        let result = build_url(&r);
        // ensure_proto defaults to http:// for regular domains
        assert_eq!(result, "http://example.com/api?foo=bar");
    }

    #[test]
    fn test_build_url_adds_https_for_dev_domain() {
        let r = HttpRequest {
            url: "example.dev/api".to_string(),
            url_parameters: vec![HttpUrlParameter {
                enabled: true,
                name: "foo".to_string(),
                value: "bar".to_string(),
                id: None,
            }],
            ..Default::default()
        };

        let result = build_url(&r);
        // .dev domains force https
        assert_eq!(result, "https://example.dev/api?foo=bar");
    }

    #[test]
    fn test_build_url_with_fragment() {
        let r = HttpRequest {
            url: "https://example.com/api#section".to_string(),
            url_parameters: vec![HttpUrlParameter {
                enabled: true,
                name: "foo".to_string(),
                value: "bar".to_string(),
                id: None,
            }],
            ..Default::default()
        };

        let result = build_url(&r);
        assert_eq!(result, "https://example.com/api?foo=bar#section");
    }

    #[test]
    fn test_build_url_with_existing_query_and_fragment() {
        let r = HttpRequest {
            url: "https://yaak.app?foo=bar#some-hash".to_string(),
            url_parameters: vec![HttpUrlParameter {
                enabled: true,
                name: "baz".to_string(),
                value: "qux".to_string(),
                id: None,
            }],
            ..Default::default()
        };

        let result = build_url(&r);
        assert_eq!(result, "https://yaak.app?foo=bar&baz=qux#some-hash");
    }

    #[test]
    fn test_build_url_with_empty_query_and_fragment() {
        let r = HttpRequest {
            url: "https://example.com/api?#section".to_string(),
            url_parameters: vec![HttpUrlParameter {
                enabled: true,
                name: "foo".to_string(),
                value: "bar".to_string(),
                id: None,
            }],
            ..Default::default()
        };

        let result = build_url(&r);
        assert_eq!(result, "https://example.com/api?foo=bar#section");
    }

    #[test]
    fn test_build_url_with_fragment_containing_special_chars() {
        let r = HttpRequest {
            url: "https://example.com#section/with/slashes?and=fake&query".to_string(),
            url_parameters: vec![HttpUrlParameter {
                enabled: true,
                name: "real".to_string(),
                value: "param".to_string(),
                id: None,
            }],
            ..Default::default()
        };

        let result = build_url(&r);
        assert_eq!(result, "https://example.com?real=param#section/with/slashes?and=fake&query");
    }

    #[test]
    fn test_build_url_preserves_empty_fragment() {
        let r = HttpRequest {
            url: "https://example.com/api#".to_string(),
            url_parameters: vec![HttpUrlParameter {
                enabled: true,
                name: "foo".to_string(),
                value: "bar".to_string(),
                id: None,
            }],
            ..Default::default()
        };

        let result = build_url(&r);
        assert_eq!(result, "https://example.com/api?foo=bar#");
    }

    #[test]
    fn test_build_url_with_multiple_fragments() {
        // Testing edge case where the URL has multiple # characters (though technically invalid)
        let r = HttpRequest {
            url: "https://example.com#section#subsection".to_string(),
            url_parameters: vec![HttpUrlParameter {
                enabled: true,
                name: "foo".to_string(),
                value: "bar".to_string(),
                id: None,
            }],
            ..Default::default()
        };

        let result = build_url(&r);
        // Should treat everything after first # as fragment
        assert_eq!(result, "https://example.com?foo=bar#section#subsection");
    }

    #[tokio::test]
    async fn test_text_body() {
        let mut body = BTreeMap::new();
        body.insert("text".to_string(), json!("Hello, World!"));

        let result = build_text_body(&body);
        match result {
            Some(SendableBodyWithMeta::Bytes(bytes)) => {
                assert_eq!(bytes, Bytes::from("Hello, World!"))
            }
            _ => panic!("Expected Some(SendableBody::Bytes)"),
        }
    }

    #[tokio::test]
    async fn test_text_body_empty() {
        let mut body = BTreeMap::new();
        body.insert("text".to_string(), json!(""));

        let result = build_text_body(&body);
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_text_body_missing() {
        let body = BTreeMap::new();

        let result = build_text_body(&body);
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_form_urlencoded_body() -> Result<()> {
        let mut body = BTreeMap::new();
        body.insert(
            "form".to_string(),
            json!([
                { "enabled": true, "name": "basic", "value": "aaa"},
                { "enabled": true, "name": "fUnkey Stuff!$*#(", "value": "*)%&#$)@ *$#)@&"},
                { "enabled": false, "name": "disabled", "value": "won't show"},
            ]),
        );

        let result = build_form_body(&body);
        match result {
            Some(SendableBodyWithMeta::Bytes(bytes)) => {
                let expected = "basic=aaa&fUnkey%20Stuff%21%24%2A%23%28=%2A%29%25%26%23%24%29%40%20%2A%24%23%29%40%26";
                assert_eq!(bytes, Bytes::from(expected));
            }
            _ => panic!("Expected Some(SendableBody::Bytes)"),
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_form_urlencoded_body_missing_form() {
        let body = BTreeMap::new();
        let result = build_form_body(&body);
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_binary_body() -> Result<()> {
        let mut body = BTreeMap::new();
        body.insert("filePath".to_string(), json!("./tests/test.txt"));

        let result = build_binary_body(&body).await?;
        assert!(matches!(result, Some(SendableBodyWithMeta::Stream { .. })));
        Ok(())
    }

    #[tokio::test]
    async fn test_binary_body_file_not_found() {
        let mut body = BTreeMap::new();
        body.insert("filePath".to_string(), json!("./nonexistent/file.txt"));

        let result = build_binary_body(&body).await;
        assert!(result.is_err());
        if let Err(e) = result {
            assert!(matches!(e, RequestError(_)));
        }
    }

    #[tokio::test]
    async fn test_graphql_body_with_variables() {
        let mut body = BTreeMap::new();
        body.insert("query".to_string(), json!("{ user(id: $id) { name } }"));
        body.insert("variables".to_string(), json!(r#"{"id": "123"}"#));

        let result = build_graphql_body("POST", &body);
        match result {
            Some(SendableBodyWithMeta::Bytes(bytes)) => {
                let expected =
                    r#"{"query":"{ user(id: $id) { name } }","variables":{"id": "123"}}"#;
                assert_eq!(bytes, Bytes::from(expected));
            }
            _ => panic!("Expected Some(SendableBody::Bytes)"),
        }
    }

    #[tokio::test]
    async fn test_graphql_body_without_variables() {
        let mut body = BTreeMap::new();
        body.insert("query".to_string(), json!("{ users { name } }"));
        body.insert("variables".to_string(), json!(""));

        let result = build_graphql_body("POST", &body);
        match result {
            Some(SendableBodyWithMeta::Bytes(bytes)) => {
                let expected = r#"{"query":"{ users { name } }"}"#;
                assert_eq!(bytes, Bytes::from(expected));
            }
            _ => panic!("Expected Some(SendableBody::Bytes)"),
        }
    }

    #[tokio::test]
    async fn test_graphql_body_get_method() {
        let mut body = BTreeMap::new();
        body.insert("query".to_string(), json!("{ users { name } }"));

        let result = build_graphql_body("GET", &body);
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_multipart_body_text_fields() -> Result<()> {
        let mut body = BTreeMap::new();
        body.insert(
            "form".to_string(),
            json!([
                { "enabled": true, "name": "field1", "value": "value1", "file": "" },
                { "enabled": true, "name": "field2", "value": "value2", "file": "" },
                { "enabled": false, "name": "disabled", "value": "won't show", "file": "" },
            ]),
        );

        let (result, content_type) = build_multipart_body(&body, &vec![]).await?;
        assert!(content_type.is_some());

        match result {
            Some(SendableBodyWithMeta::Stream { data: mut stream, content_length }) => {
                // Read the entire stream to verify content
                let mut buf = Vec::new();
                use tokio::io::AsyncReadExt;
                stream.read_to_end(&mut buf).await.expect("Failed to read stream");
                let body_str = String::from_utf8_lossy(&buf);
                assert_eq!(
                    body_str,
                    "--------YaakFormBoundary\r\nContent-Disposition: form-data; name=\"field1\"\r\n\r\nvalue1\r\n--------YaakFormBoundary\r\nContent-Disposition: form-data; name=\"field2\"\r\n\r\nvalue2\r\n--------YaakFormBoundary--\r\n",
                );
                assert_eq!(content_length, Some(body_str.len()));
            }
            _ => panic!("Expected Some(SendableBody::Stream)"),
        }

        assert_eq!(
            content_type.unwrap(),
            format!("multipart/form-data; boundary={}", MULTIPART_BOUNDARY)
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_multipart_body_with_file() -> Result<()> {
        let mut body = BTreeMap::new();
        body.insert(
            "form".to_string(),
            json!([
                { "enabled": true, "name": "file_field", "file": "./tests/test.txt", "filename": "custom.txt", "contentType": "text/plain" },
            ]),
        );

        let (result, content_type) = build_multipart_body(&body, &vec![]).await?;
        assert!(content_type.is_some());

        match result {
            Some(SendableBodyWithMeta::Stream { data: mut stream, content_length }) => {
                // Read the entire stream to verify content
                let mut buf = Vec::new();
                use tokio::io::AsyncReadExt;
                stream.read_to_end(&mut buf).await.expect("Failed to read stream");
                let body_str = String::from_utf8_lossy(&buf);
                assert_eq!(
                    body_str,
                    "--------YaakFormBoundary\r\nContent-Disposition: form-data; name=\"file_field\"; filename=\"custom.txt\"\r\nContent-Type: text/plain\r\n\r\nThis is a test file!\n\r\n--------YaakFormBoundary--\r\n"
                );
                assert_eq!(content_length, Some(body_str.len()));
            }
            _ => panic!("Expected Some(SendableBody::Stream)"),
        }

        assert_eq!(
            content_type.unwrap(),
            format!("multipart/form-data; boundary={}", MULTIPART_BOUNDARY)
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_multipart_body_empty() -> Result<()> {
        let body = BTreeMap::new();
        let (result, content_type) = build_multipart_body(&body, &vec![]).await?;
        assert!(result.is_none());
        assert_eq!(content_type, None);
        Ok(())
    }

    #[test]
    fn test_extract_boundary_from_headers_with_custom_boundary() {
        let headers = vec![(
            "Content-Type".to_string(),
            "multipart/form-data; boundary=customBoundary123".to_string(),
        )];
        let boundary = extract_boundary_from_headers(&headers);
        assert_eq!(boundary, "customBoundary123");
    }

    #[test]
    fn test_extract_boundary_from_headers_default() {
        let headers = vec![("Accept".to_string(), "*/*".to_string())];
        let boundary = extract_boundary_from_headers(&headers);
        assert_eq!(boundary, MULTIPART_BOUNDARY);
    }

    #[test]
    fn test_extract_boundary_from_headers_no_boundary_in_content_type() {
        let headers = vec![("Content-Type".to_string(), "multipart/form-data".to_string())];
        let boundary = extract_boundary_from_headers(&headers);
        assert_eq!(boundary, MULTIPART_BOUNDARY);
    }

    #[test]
    fn test_extract_boundary_case_insensitive() {
        let headers = vec![(
            "Content-Type".to_string(),
            "multipart/form-data; boundary=myBoundary".to_string(),
        )];
        let boundary = extract_boundary_from_headers(&headers);
        assert_eq!(boundary, "myBoundary");
    }

    #[tokio::test]
    async fn test_no_content_length_with_chunked_encoding() -> Result<()> {
        let mut body = BTreeMap::new();
        body.insert("text".to_string(), json!("Hello, World!"));

        // Headers with Transfer-Encoding: chunked
        let headers = vec![("Transfer-Encoding".to_string(), "chunked".to_string())];

        let (_, result_headers) =
            build_body("POST", &Some("text/plain".to_string()), &body, headers).await?;

        // Verify that Content-Length is NOT present when Transfer-Encoding: chunked is set
        let has_content_length =
            result_headers.iter().any(|h| h.0.to_lowercase() == "content-length");
        assert!(!has_content_length, "Content-Length should not be present with chunked encoding");

        // Verify that the Transfer-Encoding header is still present
        let has_chunked = result_headers.iter().any(|h| {
            h.0.to_lowercase() == "transfer-encoding" && h.1.to_lowercase().contains("chunked")
        });
        assert!(has_chunked, "Transfer-Encoding: chunked should be preserved");

        Ok(())
    }

    #[tokio::test]
    async fn test_content_length_without_chunked_encoding() -> Result<()> {
        let mut body = BTreeMap::new();
        body.insert("text".to_string(), json!("Hello, World!"));

        // Headers without Transfer-Encoding: chunked
        let headers = vec![];

        let (_, result_headers) =
            build_body("POST", &Some("text/plain".to_string()), &body, headers).await?;

        // Verify that Content-Length IS present when Transfer-Encoding: chunked is NOT set
        let content_length_header =
            result_headers.iter().find(|h| h.0.to_lowercase() == "content-length");
        assert!(
            content_length_header.is_some(),
            "Content-Length should be present without chunked encoding"
        );
        assert_eq!(
            content_length_header.unwrap().1,
            "13",
            "Content-Length should match the body size"
        );

        Ok(())
    }
}
