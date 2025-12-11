use crate::error::Error::BodyError;
use crate::error::Result;
use log::warn;
use std::collections::BTreeMap;
use yaak_common::serde::{get_bool, get_str, get_str_map};
use yaak_models::models::HttpRequest;

// Hardcoded multipart boundary that's unlikely to conflict with content
pub const MULTIPART_BOUNDARY: &str = "----YaakFormBoundary7MA4YWxkTrZu0gW";

pub struct SendableHttpRequestHeader {
    pub name: String,
    pub value: String,
}

pub struct SendableHttpRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<SendableHttpRequestHeader>,
    pub body: Option<Vec<u8>>,
}

impl SendableHttpRequest {
    pub async fn from_http_request(r: &HttpRequest) -> Result<Self> {
        Ok(Self {
            url: r.url.clone(),
            method: r.method.to_uppercase(),
            headers: build_headers(r),
            body: build_body(r).await?,
        })
    }
}
fn build_headers(r: &HttpRequest) -> Vec<SendableHttpRequestHeader> {
    r.headers
        .iter()
        .filter_map(|h| {
            if h.enabled {
                Some(SendableHttpRequestHeader {
                    name: h.name.clone(),
                    value: h.value.clone(),
                })
            } else {
                None
            }
        })
        .collect()
}

async fn build_body(r: &HttpRequest) -> Result<Option<Vec<u8>>> {
    let body_type = match &r.body_type {
        None => return Ok(None),
        Some(t) => t,
    };

    let b = match body_type.as_str() {
        "binary" => build_binary_body(&r.body).await?,
        "graphql" => build_graphql_body(&r.method, &r.body).map(|b| b.into_bytes()),
        "application/x-www-form-urlencoded" => build_form_body(&r.body).map(|b| b.into_bytes()),
        "multipart/form-data" => build_multipart_body(&r.body).await?,
        _ if r.body.contains_key("text") => build_text_body(&r.body).map(|b| b.bytes().collect()),
        t => {
            warn!("Unsupported body type: {}", t);
            None
        }
    };

    Ok(b)
}

fn build_form_body(body: &BTreeMap<String, serde_json::Value>) -> Option<String> {
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

    Some(body)
}

async fn build_binary_body(body: &BTreeMap<String, serde_json::Value>) -> Result<Option<Vec<u8>>> {
    let file_path = match body.get("filePath").map(|f| f.as_str()) {
        Some(Some(f)) => f,
        _ => return Ok(None),
    };

    // Read and return file contents
    let contents = tokio::fs::read(file_path)
        .await
        .map_err(|e| BodyError(format!("Failed to read file: {}", e)))?;
    Ok(Some(contents))
}

fn build_text_body(body: &BTreeMap<String, serde_json::Value>) -> Option<&str> {
    let text = get_str_map(body, "text");
    if text.is_empty() { None } else { Some(text) }
}

fn build_graphql_body(method: &str, body: &BTreeMap<String, serde_json::Value>) -> Option<String> {
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

    Some(body)
}

async fn build_multipart_body(
    body: &BTreeMap<String, serde_json::Value>,
) -> Result<Option<Vec<u8>>> {
    let form_params = match body.get("form").map(|f| f.as_array()) {
        Some(Some(f)) => f,
        _ => return Ok(None),
    };

    let mut body_bytes = Vec::new();

    for p in form_params {
        let enabled = get_bool(p, "enabled", true);
        let name = get_str(p, "name");
        if !enabled || name.is_empty() {
            continue;
        }

        // Add boundary delimiter
        body_bytes.extend_from_slice(format!("--{}\r\n", MULTIPART_BOUNDARY).as_bytes());

        let file_path = get_str(p, "file");
        let value = get_str(p, "value");
        let content_type = get_str(p, "contentType");

        if file_path.is_empty() {
            // Text field
            body_bytes.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{}\"\r\n\r\n", name).as_bytes(),
            );
            body_bytes.extend_from_slice(value.as_bytes());
        } else {
            // File field
            let filename = get_str(p, "filename");
            let filename = if filename.is_empty() {
                std::path::Path::new(file_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("file")
            } else {
                filename
            };

            body_bytes.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\n",
                    name, filename
                )
                .as_bytes(),
            );

            // Add content type
            let mime_type = if !content_type.is_empty() {
                content_type.to_string()
            } else {
                // Guess mime type from file extension
                mime_guess::from_path(file_path).first_or_octet_stream().to_string()
            };
            body_bytes.extend_from_slice(format!("Content-Type: {}\r\n\r\n", mime_type).as_bytes());

            // Read and append file contents
            let file_contents = tokio::fs::read(file_path)
                .await
                .map_err(|e| BodyError(format!("Failed to read file: {}", e)))?;
            body_bytes.extend_from_slice(&file_contents);
        }

        body_bytes.extend_from_slice(b"\r\n");
    }

    // Add final boundary
    if !body_bytes.is_empty() {
        body_bytes.extend_from_slice(format!("--{}--\r\n", MULTIPART_BOUNDARY).as_bytes());
        Ok(Some(body_bytes))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

    #[tokio::test]
    async fn test_text_body() {
        let mut body = BTreeMap::new();
        body.insert("text".to_string(), json!("Hello, World!"));

        let result = build_text_body(&body);
        assert_eq!(result, Some("Hello, World!"));
    }

    #[tokio::test]
    async fn test_text_body_empty() {
        let mut body = BTreeMap::new();
        body.insert("text".to_string(), json!(""));

        let result = build_text_body(&body);
        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn test_text_body_missing() {
        let body = BTreeMap::new();

        let result = build_text_body(&body);
        assert_eq!(result, None);
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
        assert_eq!(result, Some("basic=aaa&fUnkey%20Stuff%21%24%2A%23%28=%2A%29%25%26%23%24%29%40%20%2A%24%23%29%40%26".to_string()));
        Ok(())
    }

    #[tokio::test]
    async fn test_form_urlencoded_body_missing_form() {
        let body = BTreeMap::new();

        let result = build_form_body(&body);
        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn test_binary_body() -> Result<()> {
        let mut body = BTreeMap::new();
        body.insert("filePath".to_string(), json!("./tests/test.txt"));

        let result = build_binary_body(&body).await?;
        let result_str = result.map(|bytes| String::from_utf8(bytes).unwrap());
        assert_eq!(result_str, Some("This is a test file!\n".to_string()));
        Ok(())
    }

    #[tokio::test]
    async fn test_binary_body_file_not_found() {
        let mut body = BTreeMap::new();
        body.insert("filePath".to_string(), json!("./nonexistent/file.txt"));

        let result = build_binary_body(&body).await;
        assert!(result.is_err());
        if let Err(e) = result {
            assert!(matches!(e, BodyError(_)));
        }
    }

    #[tokio::test]
    async fn test_graphql_body_with_variables() {
        let mut body = BTreeMap::new();
        body.insert("query".to_string(), json!("{ user(id: $id) { name } }"));
        body.insert("variables".to_string(), json!(r#"{"id": "123"}"#));

        let result = build_graphql_body("POST", &body);
        assert_eq!(
            result,
            Some(r#"{"query":"{ user(id: $id) { name } }","variables":{"id": "123"}}"#.to_string())
        );
    }

    #[tokio::test]
    async fn test_graphql_body_without_variables() {
        let mut body = BTreeMap::new();
        body.insert("query".to_string(), json!("{ users { name } }"));
        body.insert("variables".to_string(), json!(""));

        let result = build_graphql_body("POST", &body);
        assert_eq!(result, Some(r#"{"query":"{ users { name } }"}"#.to_string()));
    }

    #[tokio::test]
    async fn test_graphql_body_get_method() {
        let mut body = BTreeMap::new();
        body.insert("query".to_string(), json!("{ users { name } }"));

        let result = build_graphql_body("GET", &body);
        assert_eq!(result, None);
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

        let result = build_multipart_body(&body).await?;
        assert!(result.is_some());

        let body_bytes = result.unwrap();
        let body_str = String::from_utf8_lossy(&body_bytes);
        assert!(body_str.contains("Content-Disposition: form-data; name=\"field1\""));
        assert!(body_str.contains("value1"));
        assert!(body_str.contains("Content-Disposition: form-data; name=\"field2\""));
        assert!(body_str.contains("value2"));
        assert!(!body_str.contains("disabled"));
        assert!(body_str.starts_with(&format!("--{}", MULTIPART_BOUNDARY)));
        assert!(body_str.ends_with(&format!("--{}--\r\n", MULTIPART_BOUNDARY)));

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

        let result = build_multipart_body(&body).await?;
        assert!(result.is_some());

        let body_bytes = result.unwrap();
        let body_str = String::from_utf8_lossy(&body_bytes);
        assert!(body_str.contains(
            "Content-Disposition: form-data; name=\"file_field\"; filename=\"custom.txt\""
        ));
        assert!(body_str.contains("Content-Type: text/plain"));
        assert!(body_str.contains("This is a test file!")); // Content of test.txt

        Ok(())
    }

    #[tokio::test]
    async fn test_multipart_body_empty() -> Result<()> {
        let body = BTreeMap::new();

        let result = build_multipart_body(&body).await?;
        assert_eq!(result, None);

        Ok(())
    }
}
