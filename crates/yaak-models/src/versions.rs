//! Content addressing for model versions.
//!
//! A version's identity is its *content*, so the two functions here — what
//! counts as content, and how content becomes a hash — are the whole of it.
//! Everything else about versioning (when to capture, what to keep, how to
//! restore) is built on top and stays in `queries::model_versions`.

use crate::error::Result;
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

/// Keys that describe a model's place in the workspace rather than what the
/// user typed into it.
///
/// Dropping them is what makes a version stable: moving a request into a
/// folder, dragging it up the sidebar, or simply saving it again all rewrite
/// these and nothing else, and none of them should mint a version or show up
/// in a diff. It is also why one rule covers HTTP, gRPC and WebSocket — the
/// three differ only in the content fields, which are all kept.
const BOOKKEEPING_KEYS: &[&str] =
    &["model", "id", "createdAt", "updatedAt", "workspaceId", "folderId", "sortPriority"];

/// The editable content of a model, as the object a version stores.
pub fn version_document<T: Serialize>(model: &T) -> Result<Value> {
    let mut value = serde_json::to_value(model)?;
    if let Some(object) = value.as_object_mut() {
        for key in BOOKKEEPING_KEYS {
            object.remove(*key);
        }
    }
    Ok(value)
}

/// The hash a version is addressed by.
///
/// Canonical by construction: `serde_json::Map` is a `BTreeMap` here, so
/// serialization already visits keys in sorted order and two documents that
/// differ only in key order hash the same.
pub fn content_hash(document: &Value) -> Result<String> {
    let canonical = serde_json::to_vec(document)?;
    Ok(hex::encode(Sha256::digest(&canonical)))
}

/// Lay a version's document back over a live model.
///
/// Keys the document carries win; keys it doesn't mention keep whatever the
/// live model has. That covers both halves of a restore: bookkeeping (id,
/// folder, sort order) survives because the document never held it, and a field
/// added to the model after the version was captured survives because the
/// version predates it.
pub fn apply_version_document(live: &Value, document: &Value) -> Value {
    let mut merged = live.as_object().cloned().unwrap_or_else(Map::new);
    if let Some(document) = document.as_object() {
        for (key, value) in document {
            merged.insert(key.clone(), value.clone());
        }
    }
    Value::Object(merged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{HttpRequest, HttpRequestHeader};
    use chrono::Utc;

    fn request() -> HttpRequest {
        HttpRequest {
            id: "rq_1".to_string(),
            workspace_id: "wk_1".to_string(),
            folder_id: Some("fl_1".to_string()),
            name: "Get user".to_string(),
            url: "https://example.com/users/1".to_string(),
            method: "GET".to_string(),
            sort_priority: 1.0,
            headers: vec![HttpRequestHeader {
                name: "Accept".to_string(),
                value: "application/json".to_string(),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    fn hash_of(request: &HttpRequest) -> String {
        content_hash(&version_document(request).unwrap()).unwrap()
    }

    #[test]
    fn document_holds_content_and_drops_bookkeeping() {
        let document = version_document(&request()).unwrap();
        let object = document.as_object().unwrap();

        for key in BOOKKEEPING_KEYS {
            assert!(!object.contains_key(*key), "document should not carry {key}");
        }

        assert_eq!(object.get("url").unwrap(), "https://example.com/users/1");
        assert_eq!(object.get("name").unwrap(), "Get user");
        assert_eq!(object.get("method").unwrap(), "GET");
        assert!(object.contains_key("headers"));
        assert!(object.contains_key("body"));
        assert!(object.contains_key("authentication"));
        assert!(object.contains_key("description"));
        assert!(object.contains_key("settingFollowRedirects"));
    }

    #[test]
    fn bookkeeping_never_changes_the_hash() {
        let base = hash_of(&request());

        let moved = HttpRequest { folder_id: Some("fl_2".to_string()), ..request() };
        assert_eq!(hash_of(&moved), base, "folder");

        let resorted = HttpRequest { sort_priority: 99.5, ..request() };
        assert_eq!(hash_of(&resorted), base, "sort priority");

        let touched =
            HttpRequest { updated_at: Utc::now().naive_utc(), created_at: Utc::now().naive_utc(), ..request() };
        assert_eq!(hash_of(&touched), base, "timestamps");

        let renamed_id = HttpRequest { id: "rq_2".to_string(), ..request() };
        assert_eq!(hash_of(&renamed_id), base, "id");

        let moved_workspace = HttpRequest { workspace_id: "wk_2".to_string(), ..request() };
        assert_eq!(hash_of(&moved_workspace), base, "workspace");
    }

    #[test]
    fn editable_content_changes_the_hash() {
        let base = hash_of(&request());

        assert_ne!(hash_of(&HttpRequest { url: "https://example.com/users/2".into(), ..request() }), base);
        assert_ne!(hash_of(&HttpRequest { method: "POST".into(), ..request() }), base);
        assert_ne!(hash_of(&HttpRequest { name: "Get other user".into(), ..request() }), base);
        assert_ne!(hash_of(&HttpRequest { description: "Notes".into(), ..request() }), base);
        assert_ne!(hash_of(&HttpRequest { headers: vec![], ..request() }), base);
        assert_ne!(
            hash_of(&HttpRequest { body_type: Some("application/json".into()), ..request() }),
            base
        );
    }

    /// The hash has to survive being written to and read back from the
    /// database, which does not preserve key order.
    #[test]
    fn key_order_does_not_change_the_hash() {
        let a: Value = serde_json::from_str(r#"{"url":"a","method":"GET"}"#).unwrap();
        let b: Value = serde_json::from_str(r#"{"method":"GET","url":"a"}"#).unwrap();
        assert_eq!(content_hash(&a).unwrap(), content_hash(&b).unwrap());
    }

    #[test]
    fn applying_a_document_keeps_the_live_model_identity() {
        let live = serde_json::to_value(request()).unwrap();
        let document = version_document(&HttpRequest {
            url: "https://example.com/users/2".to_string(),
            ..request()
        })
        .unwrap();

        let merged = apply_version_document(&live, &document);
        let object = merged.as_object().unwrap();

        assert_eq!(object.get("url").unwrap(), "https://example.com/users/2");
        assert_eq!(object.get("id").unwrap(), "rq_1");
        assert_eq!(object.get("folderId").unwrap(), "fl_1");
        assert_eq!(object.get("sortPriority").unwrap(), 1.0);
        assert_eq!(object.get("model").unwrap(), "http_request");
    }

    /// A version captured before a field existed must not blank that field out.
    #[test]
    fn applying_an_older_document_leaves_unknown_fields_alone() {
        let live = serde_json::to_value(request()).unwrap();
        let document = serde_json::json!({ "url": "https://example.com/old" });

        let merged = apply_version_document(&live, &document);
        let object = merged.as_object().unwrap();

        assert_eq!(object.get("url").unwrap(), "https://example.com/old");
        assert_eq!(object.get("method").unwrap(), "GET");
        assert_eq!(object.get("name").unwrap(), "Get user");
    }
}
