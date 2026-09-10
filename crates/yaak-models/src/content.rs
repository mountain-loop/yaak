//! What counts as a model's *content*, and how content becomes a hash.
//!
//! Several features need to answer "are these two models the same?" without
//! being fooled by the fields that change every time a model is written at all:
//! request versioning asks it to decide whether to capture a new version,
//! import asks it to decide whether a re-import is a change or a conflict.
//! They ask slightly different questions — see [`PLACEMENT_KEYS`] — so what is
//! shared here is the mechanism and the reasoning, not one fixed answer.
//!
//! The implementation is lifted from the import merge work on
//! `import-remember-selection` (#619), which got here first and got it right;
//! that branch's private copy should become a call into this module when it
//! lands.
//!
//! Not shared with directory sync, deliberately. Sync checksums the *bytes of a
//! file* to notice that someone edited it on disk, so its hash has to reflect
//! formatting and key order — exactly what this module throws away.

use crate::error::Result;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Fields that say which model this is and when it was last touched, rather
/// than anything a user typed.
///
/// Every model carries them and every write rewrites at least `updatedAt`, so
/// leaving them in would make every model differ from every copy of itself.
/// `id` is not listed because it needs [`strip_ids`], which reaches nested rows
/// too.
pub const IDENTITY_KEYS: &[&str] = &["model", "workspaceId", "createdAt", "updatedAt"];

/// Fields that say where a model sits, rather than what it holds.
///
/// `sortPriority` is not content for anybody: importers number it from source
/// order, so comparing it turns one insertion into an update of everything
/// after it, and dragging a request up the sidebar is not an edit.
///
/// `folderId` is where the two callers actually part company, and it is a real
/// disagreement rather than an oversight. Versioning drops it: moving a request
/// into a folder is not an edit and must not mint a version. Import keeps it:
/// equality there means "same content in the same place", so a source that
/// moved a resource is showing you a change.
pub const PLACEMENT_KEYS: &[&str] = &["folderId", "sortPriority"];

/// A model's JSON with the named top-level keys removed.
pub fn without_keys(mut value: Value, keys: &[&str]) -> Value {
    if let Some(object) = value.as_object_mut() {
        for key in keys {
            object.remove(*key);
        }
    }
    value
}

/// Drop every `id`, at every depth.
///
/// A header, parameter, or variable carries an `id` that identifies its row to
/// the editor rather than anything about its content, and the editor fills
/// those in the first time it touches a resource. Dropping every `id` keeps
/// that from reading as a change — otherwise merely opening a request would
/// look like an edit of all of its headers at once.
pub fn strip_ids(value: Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .filter(|(key, _)| key != "id")
                .map(|(key, value)| (key, strip_ids(value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(strip_ids).collect()),
        other => other,
    }
}

/// Prefix on every hash this module writes.
///
/// A hash written by a version a build doesn't understand says nothing about
/// the content, and the caller needs to be able to tell that apart from a hash
/// that says "different". Bump it whenever the stripping or the canonical form
/// changes.
pub const CONTENT_HASH_VERSION: &str = "v1:";

/// A stable hash of a document's content.
pub fn content_hash(document: &Value) -> Result<String> {
    let canonical = serde_json::to_string(&sorted_keys(document.clone()))?;
    Ok(format!("{CONTENT_HASH_VERSION}{:x}", Sha256::digest(canonical.as_bytes())))
}

/// Whether a stored hash was written by an algorithm this build understands.
pub fn hash_is_readable(hash: &str) -> bool {
    hash.starts_with(CONTENT_HASH_VERSION)
}

/// Rebuild every object with its keys in sorted order.
///
/// Serializing straight from the input would not do: whether
/// `serde_json::Map` preserves insertion order or sorts is a workspace-wide
/// feature decision — `preserve_order` is on in some builds of this workspace
/// and off in others — and a document read back from SQLite has whatever order
/// it was written in. Sorting first makes the hash depend on the content and
/// nothing else, in every build.
fn sorted_keys(value: Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut entries = object.into_iter().collect::<Vec<_>>();
            entries.sort_by(|(a, _), (b, _)| a.cmp(b));
            Value::Object(entries.into_iter().map(|(k, v)| (k, sorted_keys(v))).collect())
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sorted_keys).collect()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The hash has to survive a round trip through SQLite, which stores a
    /// document as text and hands back whatever order it was written in. It
    /// also has to survive `serde_json`'s `preserve_order` feature being on in
    /// one build of the workspace and off in another.
    #[test]
    fn key_order_does_not_change_the_hash() {
        let a: Value = serde_json::from_str(r#"{"url":"a","method":"GET"}"#).unwrap();
        let b: Value = serde_json::from_str(r#"{"method":"GET","url":"a"}"#).unwrap();
        assert_eq!(content_hash(&a).unwrap(), content_hash(&b).unwrap());
    }

    #[test]
    fn key_order_does_not_change_the_hash_when_nested() {
        let a: Value =
            serde_json::from_str(r#"{"body":{"text":"x","type":"json"},"headers":[{"a":1,"b":2}]}"#)
                .unwrap();
        let b: Value =
            serde_json::from_str(r#"{"headers":[{"b":2,"a":1}],"body":{"type":"json","text":"x"}}"#)
                .unwrap();
        assert_eq!(content_hash(&a).unwrap(), content_hash(&b).unwrap());
    }

    /// Sorting keys must not make different documents collide.
    #[test]
    fn array_order_still_changes_the_hash() {
        let a: Value = serde_json::from_str(r#"{"headers":[{"n":"a"},{"n":"b"}]}"#).unwrap();
        let b: Value = serde_json::from_str(r#"{"headers":[{"n":"b"},{"n":"a"}]}"#).unwrap();
        assert_ne!(content_hash(&a).unwrap(), content_hash(&b).unwrap());
    }

    #[test]
    fn hashes_carry_a_readable_version() {
        let hash = content_hash(&json!({"url": "a"})).unwrap();
        assert!(hash_is_readable(&hash));
        assert!(!hash_is_readable("v99:deadbeef"));
        assert!(!hash_is_readable("deadbeef"));
    }

    #[test]
    fn without_keys_leaves_everything_else_alone() {
        let stripped = without_keys(json!({"model": "http_request", "url": "a"}), IDENTITY_KEYS);
        let object = stripped.as_object().unwrap();
        assert!(!object.contains_key("model"));
        assert_eq!(object.get("url").unwrap(), "a");
    }

    /// The editor writes row ids into headers and parameters the first time it
    /// touches a request, so nested ids have to go or that reads as an edit.
    #[test]
    fn strip_ids_reaches_nested_rows() {
        let with_ids = json!({
            "id": "rq_1",
            "url": "a",
            "headers": [{"id": "h_1", "name": "Accept", "value": "*/*"}],
        });
        let without = json!({
            "url": "a",
            "headers": [{"name": "Accept", "value": "*/*"}],
        });
        assert_eq!(strip_ids(with_ids.clone()), strip_ids(without.clone()));
        assert_eq!(
            content_hash(&strip_ids(with_ids)).unwrap(),
            content_hash(&strip_ids(without)).unwrap(),
        );
    }
}
