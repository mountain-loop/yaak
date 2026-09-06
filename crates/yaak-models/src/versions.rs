//! Request versioning's answer to "what is this request's content?"
//!
//! The mechanism lives in [`crate::content`], shared with import. What is
//! decided here is versioning's own policy: placement is not content, and a
//! restore lays a document back over the model it came from.

use crate::content::{IDENTITY_KEYS, PLACEMENT_KEYS, strip_ids, without_keys};
use crate::error::Result;
use serde::Serialize;
use serde_json::{Map, Value};

/// The editable content of a model, as the object a version stores.
///
/// Dropping [`PLACEMENT_KEYS`] as well as [`IDENTITY_KEYS`] is what makes a
/// version stable: moving a request into a folder, dragging it up the sidebar,
/// or simply saving it again rewrite those and nothing else, and none of them
/// should mint a version or show up in a diff. `strip_ids` does the same job
/// for the row ids the editor writes into headers and parameters — without it,
/// opening a request would mint a version whose diff is nothing but ids.
///
/// One rule covers HTTP, gRPC and WebSocket, because the three differ only in
/// the content fields, which are all kept.
pub fn version_document<T: Serialize>(model: &T) -> Result<Value> {
    let stripped = [IDENTITY_KEYS, PLACEMENT_KEYS].concat();
    Ok(without_keys(strip_ids(serde_json::to_value(model)?), &stripped))
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
    use crate::content::content_hash;
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

        for key in [IDENTITY_KEYS, PLACEMENT_KEYS].concat() {
            assert!(!object.contains_key(key), "document should not carry {key}");
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

    /// The other half of the split documented on [`PLACEMENT_KEYS`]. Import
    /// counts a move between folders as a change; versioning must not, or
    /// dragging a request around the sidebar would mint versions nobody asked
    /// for.
    #[test]
    fn placement_is_not_content_here_even_though_import_says_it_is() {
        let base = version_document(&request()).unwrap();
        let moved =
            version_document(&HttpRequest { folder_id: Some("fl_2".into()), ..request() }).unwrap();
        let resorted =
            version_document(&HttpRequest { sort_priority: 99.5, ..request() }).unwrap();

        assert_eq!(moved, base);
        assert_eq!(resorted, base);
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
