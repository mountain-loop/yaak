use crate::error::Error::BodyError;
use crate::error::Result;
use crate::path_placeholders::apply_path_placeholders;
use crate::proto::ensure_proto;
use log::warn;
use std::collections::BTreeMap;
use yaak_common::serde::{get_bool, get_str, get_str_map};
use yaak_models::models::HttpRequest;

pub const MULTIPART_BOUNDARY: &str = "------YaakFormBoundary";

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
        let initial_headers = build_headers(r);

        let (body, headers) = build_body(&r.method, &r.body_type, &r.body, initial_headers).await?;

        Ok(Self {
            url: build_url(r)?,
            method: r.method.to_uppercase(),
            headers,
            body,
        })
    }
}

fn build_url(r: &HttpRequest) -> Result<String> {
    let (url_string, params) = apply_path_placeholders(&ensure_proto(&r.url), &r.url_parameters);

    // Collect enabled parameters
    let params: Vec<(String, String)> = params
        .iter()
        .filter(|p| p.enabled && !p.name.is_empty())
        .map(|p| (p.name.clone(), p.value.clone()))
        .collect();

    if params.is_empty() {
        return Ok(url_string);
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
        // No existing query parameters, add with ?
        format!("{}?{}", base_and_query, query_string)
    };

    // Re-append the fragment if it exists
    if let Some(fragment) = fragment {
        result.push_str(&fragment);
    }

    Ok(result)
}

fn build_headers(r: &HttpRequest) -> Vec<SendableHttpRequestHeader> {
    let mut headers: Vec<SendableHttpRequestHeader> = r.headers
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
        .collect();

    // Add default User-Agent if not present
    if !headers.iter().any(|h| h.name.to_lowercase() == "user-agent") {
        headers.push(SendableHttpRequestHeader {
            name: "User-Agent".to_string(),
            value: "yaak".to_string(),
        });
    }

    // Add default Accept if not present
    if !headers.iter().any(|h| h.name.to_lowercase() == "accept") {
        headers.push(SendableHttpRequestHeader {
            name: "Accept".to_string(),
            value: "*/*".to_string(),
        });
    }

    headers
}

async fn build_body(
    method: &str,
    body_type: &Option<String>,
    body: &BTreeMap<String, serde_json::Value>,
    headers: Vec<SendableHttpRequestHeader>,
) -> Result<(Option<Vec<u8>>, Vec<SendableHttpRequestHeader>)> {
    let body_type = match &body_type {
        None => return Ok((None, Vec::new())),
        Some(t) => t,
    };

    let (body, content_type) = match body_type.as_str() {
        "binary" => (build_binary_body(&body).await?, None),
        "graphql" => (
            build_graphql_body(&method, &body).map(|b| b.into_bytes()),
            Some("application/json".to_string()),
        ),
        "application/x-www-form-urlencoded" => (
            build_form_body(&body).map(|b| b.into_bytes()),
            Some("application/x-www-form-urlencoded".to_string()),
        ),
        "multipart/form-data" => build_multipart_body(&body).await?,
        _ if body.contains_key("text") => {
            (build_text_body(&body).map(|b| b.bytes().collect()), None)
        }
        t => {
            warn!("Unsupported body type: {}", t);
            (None, None)
        }
    };

    // Add or update the Content-Type header
    let headers = match content_type {
        None => headers,
        Some(ct) => {
            let mut headers = headers;
            if let Some(existing) =
                headers.iter_mut().find(|h| h.name.to_lowercase() == "content-type")
            {
                existing.value = ct;
            } else {
                headers.push(SendableHttpRequestHeader {
                    name: "Content-Type".to_string(),
                    value: ct,
                });
            }
            headers
        }
    };

    Ok((body, headers))
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
) -> Result<(Option<Vec<u8>>, Option<String>)> {
    let form_params = match body.get("form").map(|f| f.as_array()) {
        Some(Some(f)) => f,
        _ => return Ok((None, None)),
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

    // Add the final boundary
    if !body_bytes.is_empty() {
        body_bytes.extend_from_slice(format!("--{}--\r\n", MULTIPART_BOUNDARY).as_bytes());
        let content_type = format!("multipart/form-data; boundary={}", MULTIPART_BOUNDARY);
        Ok((Some(body_bytes), Some(content_type)))
    } else {
        Ok((None, None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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

        let result = build_url(&r).unwrap();
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

        let result = build_url(&r).unwrap();
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

        let result = build_url(&r).unwrap();
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

        let result = build_url(&r).unwrap();
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

        let result = build_url(&r).unwrap();
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

        let result = build_url(&r).unwrap();
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

        let result = build_url(&r).unwrap();
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

        let result = build_url(&r).unwrap();
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

        let result = build_url(&r).unwrap();
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

        let result = build_url(&r).unwrap();
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

        let result = build_url(&r).unwrap();
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

        let result = build_url(&r).unwrap();
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

        let result = build_url(&r).unwrap();
        assert_eq!(result, "https://example.com/api?foo=bar#");
    }

    #[test]
    fn test_build_url_with_multiple_fragments() {
        // Testing edge case where URL has multiple # characters (though technically invalid)
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

        let result = build_url(&r).unwrap();
        // Should treat everything after first # as fragment
        assert_eq!(result, "https://example.com?foo=bar#section#subsection");
    }

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

        let (result, content_type) = build_multipart_body(&body).await?;
        assert!(result.is_some());
        assert!(content_type.is_some());

        let body_bytes = result.unwrap();
        let body_str = String::from_utf8_lossy(&body_bytes);

        assert_eq!(
            body_str,
            "--------YaakFormBoundary\r\nContent-Disposition: form-data; name=\"field1\"\r\n\r\nvalue1\r\n--------YaakFormBoundary\r\nContent-Disposition: form-data; name=\"field2\"\r\n\r\nvalue2\r\n--------YaakFormBoundary--\r\n",
        );
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

        let (result, content_type) = build_multipart_body(&body).await?;
        assert!(result.is_some());
        assert!(content_type.is_some());

        let body_bytes = result.unwrap();
        let body_str = String::from_utf8_lossy(&body_bytes);
        assert_eq!(
            body_str,
            "--------YaakFormBoundary\r\nContent-Disposition: form-data; name=\"file_field\"; filename=\"custom.txt\"\r\nContent-Type: text/plain\r\n\r\nThis is a test file!\n\r\n--------YaakFormBoundary--\r\n"
        );
        assert_eq!(
            content_type.unwrap(),
            format!("multipart/form-data; boundary={}", MULTIPART_BOUNDARY)
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_multipart_body_empty() -> Result<()> {
        let body = BTreeMap::new();

        let (result, content_type) = build_multipart_body(&body).await?;
        assert_eq!(result, None);
        assert_eq!(content_type, None);

        Ok(())
    }
}
