//! A captured flow as a Yaak request. Headers Yaak sets itself when sending, and hop-by-hop
//! headers that only meant something between the app and the proxy, are dropped and listed so
//! the save dialog can say why. Authorization is kept as the plain header it was captured as.

use crate::bodies::DecodedBody;
use crate::models::{Flow, find_header};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use yaak_models::models::{HttpRequest, HttpRequestHeader, HttpUrlParameter};

// The client's body types (`apps/yaak-client/lib/model_util.ts`).
const BODY_TYPE_JSON: &str = "application/json";
const BODY_TYPE_XML: &str = "text/xml";
const BODY_TYPE_GRAPHQL: &str = "graphql";
const BODY_TYPE_FORM_URLENCODED: &str = "application/x-www-form-urlencoded";
const BODY_TYPE_OTHER: &str = "other";

/// Removed between the app and the proxy; never forwarded as they are.
const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];
/// Yaak works these out itself when it sends the request.
const AUTOMATIC: &[&str] = &["host", "content-length", "accept-encoding"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedHeader {
    pub name: String,
    pub value: String,
    pub reason: DropReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DropReason {
    /// Only meant for the hop between the app and the proxy.
    HopByHop,
    /// Yaak sets it when it sends the request.
    SetBySending,
    /// The body is saved decoded, so its encoding no longer applies.
    BodyDecoded,
}

#[derive(Debug, Clone)]
pub struct Conversion {
    pub request: HttpRequest,
    pub dropped_headers: Vec<DroppedHeader>,
    /// What the saved request does not carry over exactly, one sentence each.
    pub warnings: Vec<String>,
}

/// `flow` as a request in no workspace yet, with `body` its request body decoded.
pub fn flow_to_request(flow: &Flow, body: &DecodedBody) -> Conversion {
    let mut warnings = Vec::new();
    let (url, url_parameters) = split_query(&flow.url);
    let (headers, dropped_headers) = split_headers(flow, body);
    let has_authorization = headers.iter().any(|h| h.name.eq_ignore_ascii_case("authorization"));
    if has_authorization {
        warnings.push("The Authorization header is saved as captured, in plain text.".into());
    }
    let (body_type, body_fields) = request_body(flow, body, &mut warnings);
    if body.truncated {
        warnings.push(format!(
            "The body was cut at the capture limit, so only its first {} bytes are saved.",
            body.data.len()
        ));
    }

    let request = HttpRequest {
        name: default_name(&url),
        method: flow.method.clone(),
        url,
        url_parameters,
        headers,
        body_type,
        body: body_fields,
        // No auth rather than inherited, so a folder's or workspace's auth cannot replace the
        // captured header when the request is sent.
        authentication_type: has_authorization.then(|| "none".to_string()),
        ..Default::default()
    };
    Conversion { request, dropped_headers, warnings }
}

/// The URL without its query, and the query as parameters.
fn split_query(url: &str) -> (String, Vec<HttpUrlParameter>) {
    let (url, fragment) = match url.split_once('#') {
        Some((url, fragment)) => (url, Some(fragment)),
        None => (url, None),
    };
    let Some((base, query)) = url.split_once('?') else {
        return (url.to_string() + &fragment.map(|f| format!("#{f}")).unwrap_or_default(), vec![]);
    };
    let params = url::form_urlencoded::parse(query.as_bytes())
        .map(|(name, value)| HttpUrlParameter {
            enabled: true,
            name: name.into_owned(),
            value: value.into_owned(),
            id: None,
        })
        .collect();
    (base.to_string() + &fragment.map(|f| format!("#{f}")).unwrap_or_default(), params)
}

fn split_headers(flow: &Flow, body: &DecodedBody) -> (Vec<HttpRequestHeader>, Vec<DroppedHeader>) {
    // Connection names further headers that are hop-by-hop for this request alone.
    let listed: Vec<String> = flow
        .request_headers
        .iter()
        .filter(|h| h.name.eq_ignore_ascii_case("connection"))
        .flat_map(|h| h.value.split(','))
        .map(|n| n.trim().to_ascii_lowercase())
        .filter(|n| !n.is_empty())
        .collect();
    let encoding = find_header(&flow.request_headers, "content-encoding");
    // A body that decodes to nothing was still decoded.
    let decoded = body.stored_size > 0
        && encoding.is_some_and(|e| !e.trim().eq_ignore_ascii_case("identity"));

    let mut kept = Vec::new();
    let mut dropped = Vec::new();
    for h in &flow.request_headers {
        let name = h.name.to_ascii_lowercase();
        let reason = if HOP_BY_HOP.contains(&name.as_str())
            || name.starts_with("proxy-")
            || name.starts_with(':')
            || listed.contains(&name)
        {
            Some(DropReason::HopByHop)
        } else if AUTOMATIC.contains(&name.as_str()) {
            Some(DropReason::SetBySending)
        } else if name == "content-encoding" && decoded {
            Some(DropReason::BodyDecoded)
        } else {
            None
        };
        match reason {
            Some(reason) => {
                dropped.push(DroppedHeader { name: h.name.clone(), value: h.value.clone(), reason })
            }
            None => kept.push(HttpRequestHeader {
                enabled: true,
                name: h.name.clone(),
                value: h.value.clone(),
                id: None,
            }),
        }
    }
    (kept, dropped)
}

fn request_body(
    flow: &Flow,
    body: &DecodedBody,
    warnings: &mut Vec<String>,
) -> (Option<String>, BTreeMap<String, Value>) {
    if body.data.is_empty() {
        return (None, BTreeMap::new());
    }
    let content_type = find_header(&flow.request_headers, "content-type").unwrap_or_default();
    let mime = content_type.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    let Ok(text) = std::str::from_utf8(&body.data) else {
        warnings.push(
            "The body is binary and is saved as text, so bytes that are not UTF-8 are replaced."
                .into(),
        );
        return text_body(BODY_TYPE_OTHER, &String::from_utf8_lossy(&body.data));
    };

    if mime == "application/json" || mime.ends_with("+json") {
        if let Some(graphql) = graphql_body(flow, text) {
            return (Some(BODY_TYPE_GRAPHQL.into()), graphql);
        }
        return text_body(BODY_TYPE_JSON, text);
    }
    if mime == "application/xml" || mime == "text/xml" || mime.ends_with("+xml") {
        return text_body(BODY_TYPE_XML, text);
    }
    if mime == BODY_TYPE_FORM_URLENCODED {
        let form: Vec<Value> = url::form_urlencoded::parse(text.as_bytes())
            .map(|(name, value)| json!({ "enabled": true, "name": name, "value": value }))
            .collect();
        return (
            Some(BODY_TYPE_FORM_URLENCODED.into()),
            BTreeMap::from([("form".into(), json!(form))]),
        );
    }
    if mime == "multipart/form-data" {
        warnings.push(
            "The multipart body is saved as text with its Content-Type, not as form fields.".into(),
        );
    }
    text_body(BODY_TYPE_OTHER, text)
}

fn text_body(body_type: &str, text: &str) -> (Option<String>, BTreeMap<String, Value>) {
    (Some(body_type.into()), BTreeMap::from([("text".into(), json!(text))]))
}

/// A JSON body posted to a GraphQL endpoint, as the client's GraphQL body.
fn graphql_body(flow: &Flow, text: &str) -> Option<BTreeMap<String, Value>> {
    let path = flow.url.split('?').next().unwrap_or_default();
    if !path.to_ascii_lowercase().ends_with("/graphql") {
        return None;
    }
    let Value::Object(body) = serde_json::from_str::<Value>(text).ok()? else {
        return None;
    };
    // Anything else, such as persisted-query `extensions`, would be lost in a GraphQL body.
    if body.keys().any(|k| !matches!(k.as_str(), "query" | "variables" | "operationName")) {
        return None;
    }
    let query = body.get("query")?.as_str()?;
    let mut fields = BTreeMap::from([("query".to_string(), json!(query))]);
    if let Some(variables) = body.get("variables").filter(|v| !v.is_null()) {
        let pretty = serde_json::to_string_pretty(variables).ok()?;
        fields.insert("variables".into(), json!(pretty));
    }
    if let Some(name) = body.get("operationName").and_then(Value::as_str) {
        fields.insert("operationName".into(), json!(name));
    }
    Some(fields)
}

/// The path, or the host for a request to the root.
fn default_name(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    match rest.split_once('/') {
        Some((_, path)) if !path.is_empty() => format!("/{path}"),
        Some((host, _)) => host.to_string(),
        None => rest.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ProxyHeader;

    fn flow(method: &str, url: &str, headers: &[(&str, &str)]) -> Flow {
        Flow {
            method: method.into(),
            url: url.into(),
            request_headers: headers
                .iter()
                .map(|(n, v)| ProxyHeader { name: (*n).into(), value: (*v).into() })
                .collect(),
            ..Default::default()
        }
    }

    fn body(data: &str) -> DecodedBody {
        DecodedBody {
            data: data.as_bytes().to_vec(),
            stored_size: data.len(),
            truncated: false,
            decode_error: None,
        }
    }

    fn names(request: &HttpRequest) -> Vec<&str> {
        request.headers.iter().map(|h| h.name.as_str()).collect()
    }

    #[test]
    fn get_without_body() {
        let f = flow(
            "GET",
            "https://api.github.com/search/issues?q=is%3Aopen+label%3Abug&per_page=5",
            &[
                ("Host", "api.github.com"),
                ("Accept", "application/json"),
                ("Accept-Encoding", "gzip, br"),
                ("Connection", "keep-alive, X-Debug"),
                ("X-Debug", "1"),
                ("Proxy-Authorization", "Basic Zm9v"),
                ("Authorization", "Bearer ghp_secret"),
            ],
        );
        let c = flow_to_request(&f, &body(""));
        let r = &c.request;
        assert_eq!(r.method, "GET");
        assert_eq!(r.url, "https://api.github.com/search/issues");
        assert_eq!(r.name, "/search/issues");
        let params: Vec<(&str, &str)> =
            r.url_parameters.iter().map(|p| (p.name.as_str(), p.value.as_str())).collect();
        assert_eq!(params, vec![("q", "is:open label:bug"), ("per_page", "5")]);
        assert_eq!(names(r), vec!["Accept", "Authorization"]);
        assert_eq!(r.headers[1].value, "Bearer ghp_secret");
        assert_eq!(r.authentication_type.as_deref(), Some("none"));
        assert_eq!(r.body_type, None);
        assert!(r.body.is_empty());

        let dropped: Vec<(&str, DropReason)> =
            c.dropped_headers.iter().map(|d| (d.name.as_str(), d.reason)).collect();
        assert_eq!(
            dropped,
            vec![
                ("Host", DropReason::SetBySending),
                ("Accept-Encoding", DropReason::SetBySending),
                ("Connection", DropReason::HopByHop),
                ("X-Debug", DropReason::HopByHop),
                ("Proxy-Authorization", DropReason::HopByHop),
            ]
        );
        assert_eq!(
            c.warnings,
            vec!["The Authorization header is saved as captured, in plain text."]
        );
    }

    #[test]
    fn json_body() {
        let f = flow(
            "POST",
            "https://api.stripe.com/v1/charges",
            &[
                ("Content-Type", "application/json; charset=utf-8"),
                ("Content-Length", "13"),
            ],
        );
        let c = flow_to_request(&f, &body(r#"{"amount":42}"#));
        assert_eq!(c.request.body_type.as_deref(), Some("application/json"));
        assert_eq!(c.request.body["text"], r#"{"amount":42}"#);
        assert_eq!(names(&c.request), vec!["Content-Type"]);
        assert!(c.warnings.is_empty());
        // Without a captured Authorization, the request inherits its folder's auth.
        assert_eq!(c.request.authentication_type, None);
    }

    #[test]
    fn vendor_json_body() {
        let f = flow("PATCH", "https://x.test/a", &[("Content-Type", "application/vnd.api+json")]);
        let c = flow_to_request(&f, &body("{}"));
        assert_eq!(c.request.body_type.as_deref(), Some("application/json"));
    }

    #[test]
    fn graphql_body() {
        let f =
            flow("POST", "https://api.github.com/graphql", &[("Content-Type", "application/json")]);
        let c = flow_to_request(
            &f,
            &body(
                r#"{"query":"query($n:Int){viewer{login}}","variables":{"n":1},"operationName":"Me"}"#,
            ),
        );
        assert_eq!(c.request.body_type.as_deref(), Some("graphql"));
        assert_eq!(c.request.body["query"], "query($n:Int){viewer{login}}");
        assert_eq!(c.request.body["variables"], "{\n  \"n\": 1\n}");
        assert_eq!(c.request.body["operationName"], "Me");

        // Fields a GraphQL body cannot hold keep it plain JSON.
        let persisted = r#"{"query":"q","extensions":{"persistedQuery":{"version":1}}}"#;
        let c = flow_to_request(&f, &body(persisted));
        assert_eq!(c.request.body_type.as_deref(), Some("application/json"));

        // The same body anywhere else is plain JSON.
        let f = flow("POST", "https://x.test/api", &[("Content-Type", "application/json")]);
        let c = flow_to_request(&f, &body(r#"{"query":"q"}"#));
        assert_eq!(c.request.body_type.as_deref(), Some("application/json"));
    }

    #[test]
    fn xml_body() {
        let f = flow("POST", "https://x.test/soap", &[("Content-Type", "application/soap+xml")]);
        let c = flow_to_request(&f, &body("<a/>"));
        assert_eq!(c.request.body_type.as_deref(), Some("text/xml"));
        assert_eq!(c.request.body["text"], "<a/>");
    }

    #[test]
    fn form_body() {
        let f = flow(
            "POST",
            "http://localhost:3000/login",
            &[("Content-Type", "application/x-www-form-urlencoded")],
        );
        let c = flow_to_request(&f, &body("user=greg&note=hello+world%21"));
        assert_eq!(c.request.body_type.as_deref(), Some("application/x-www-form-urlencoded"));
        assert_eq!(
            c.request.body["form"],
            json!([
                { "enabled": true, "name": "user", "value": "greg" },
                { "enabled": true, "name": "note", "value": "hello world!" },
            ])
        );
        assert_eq!(c.request.name, "/login");
    }

    #[test]
    fn multipart_body() {
        let content_type = "multipart/form-data; boundary=XyZ";
        let f = flow("POST", "https://x.test/upload", &[("Content-Type", content_type)]);
        let text = "--XyZ\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\n1\r\n--XyZ--\r\n";
        let c = flow_to_request(&f, &body(text));
        assert_eq!(c.request.body_type.as_deref(), Some("other"));
        assert_eq!(c.request.body["text"], text);
        assert_eq!(c.request.headers[0].value, content_type);
        assert_eq!(c.warnings.len(), 1);
    }

    #[test]
    fn text_body() {
        let f = flow("PUT", "https://x.test/", &[("Content-Type", "text/plain")]);
        let c = flow_to_request(&f, &body("hello"));
        assert_eq!(c.request.body_type.as_deref(), Some("other"));
        assert_eq!(c.request.body["text"], "hello");
        assert_eq!(c.request.name, "x.test");
    }

    #[test]
    fn binary_body() {
        let f = flow("POST", "https://x.test/bin", &[("Content-Type", "application/octet-stream")]);
        let data = DecodedBody {
            data: vec![b'a', 0xff, b'b'],
            stored_size: 3,
            truncated: false,
            decode_error: None,
        };
        let c = flow_to_request(&f, &data);
        assert_eq!(c.request.body_type.as_deref(), Some("other"));
        assert_eq!(c.request.body["text"], "a\u{fffd}b");
        assert_eq!(c.warnings.len(), 1);
    }

    #[test]
    fn decoded_empty_body() {
        let f = flow("POST", "https://x.test/", &[("Content-Encoding", "gzip")]);
        // A gzip stream of nothing: stored bytes, but an empty body once decoded.
        let data =
            DecodedBody { data: Vec::new(), stored_size: 20, truncated: false, decode_error: None };
        let c = flow_to_request(&f, &data);
        assert!(c.request.headers.is_empty());
        assert_eq!(c.dropped_headers[0].reason, DropReason::BodyDecoded);
        assert_eq!(c.request.body_type, None);
    }

    #[test]
    fn decoded_and_truncated_body() {
        let f = flow(
            "POST",
            "https://x.test/logs",
            &[
                ("Content-Type", "application/json"),
                ("Content-Encoding", "gzip"),
            ],
        );
        let data = DecodedBody {
            data: b"[1,2".to_vec(),
            stored_size: 4,
            truncated: true,
            decode_error: None,
        };
        let c = flow_to_request(&f, &data);
        assert_eq!(names(&c.request), vec!["Content-Type"]);
        assert_eq!(c.dropped_headers[0].reason, DropReason::BodyDecoded);
        assert_eq!(
            c.warnings,
            vec!["The body was cut at the capture limit, so only its first 4 bytes are saved."]
        );
    }
}
