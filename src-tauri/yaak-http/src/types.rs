use crate::error::Error::BodyError;
use crate::error::Result;
use log::warn;
use std::collections::BTreeMap;
use yaak_common::serde::{get_bool, get_str, get_str_map};
use yaak_models::models::HttpRequest;

pub struct SendableHttpRequestHeader {
    name: String,
    value: String,
}

pub struct SendableHttpRequest {
    url: String,
    method: String,
    headers: Vec<SendableHttpRequestHeader>,
    body: Option<Vec<u8>>,
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
        "application/x-www-form-urlencoded" => {
            build_form_urlencoded_body(&r.body).map(|b| b.into_bytes())
        }
        "binary" => build_binary_body(&r.body).await?,
        "graphql" => build_graphql_body(&r.method, &r.body).map(|b| b.into_bytes()),
        t => {
            warn!("Unsupported body type: {}", t);
            None
        }
    };

    Ok(b)
}

fn build_form_urlencoded_body(body: &BTreeMap<String, serde_json::Value>) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

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

        let result = build_form_urlencoded_body(&body);
        assert_eq!(result, Some("basic=aaa&fUnkey%20Stuff%21%24%2A%23%28=%2A%29%25%26%23%24%29%40%20%2A%24%23%29%40%26".to_string()));
        Ok(())
    }

    #[tokio::test]
    async fn test_form_urlencoded_body_missing_form() {
        let body = BTreeMap::new();

        let result = build_form_urlencoded_body(&body);
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
}
