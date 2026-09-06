//! What counts as a model's *content*, and how content becomes a hash.
//!
//! Several features need to answer "are these two models the same?" without
//! being fooled by the fields that change every time a model is written at all:
//! request versioning asks it to decide whether to capture a new version,
//! import asks it to decide whether a re-import is a change or a conflict.
//! They ask slightly different questions — see [`PLACEMENT_KEYS`] — so what is
//! shared here is the mechanism and the reasoning, not one fixed answer.
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
pub const IDENTITY_KEYS: &[&str] = &["model", "id", "createdAt", "updatedAt", "workspaceId"];

/// Fields that say where a model sits among its siblings.
///
/// Whether these are content depends on the question being asked, which is why
/// they are a separate list. Versioning drops them: dragging a request into a
/// folder or up the sidebar is not an edit and must not mint a version or show
/// up in a diff. Import keeps them: a re-import that moved a resource somewhere
/// else *is* a change worth showing, because equality there means "same content
/// in the same place".
pub const PLACEMENT_KEYS: &[&str] = &["folderId", "sortPriority"];

/// A model's JSON with the named keys removed.
pub fn without_keys(mut value: Value, keys: &[&str]) -> Value {
    if let Some(object) = value.as_object_mut() {
        for key in keys {
            object.remove(*key);
        }
    }
    value
}

/// A stable hash of a document's content.
pub fn content_hash(document: &Value) -> Result<String> {
    let mut canonical = String::new();
    write_canonical(document, &mut canonical);
    Ok(hex::encode(Sha256::digest(canonical.as_bytes())))
}

/// Serialize with object keys in sorted order.
///
/// Plain `to_string` would not do: whether `serde_json::Map` preserves
/// insertion order or sorts is a workspace-wide feature decision — with
/// `preserve_order` on in some builds of this workspace and off in others — and
/// a document read back from SQLite has whatever order it was written in.
/// Sorting here makes the hash depend on the content and nothing else, in every
/// build.
fn write_canonical(value: &Value, out: &mut String) {
    match value {
        Value::Object(map) => {
            let mut keys = map.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            out.push('{');
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(&Value::String(key.clone()), out);
                out.push(':');
                write_canonical(&map[key], out);
            }
            out.push('}');
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        scalar => out.push_str(&scalar.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn without_keys_leaves_everything_else_alone() {
        let value: Value = serde_json::json!({"id": "rq_1", "url": "a", "name": "n"});
        let stripped = without_keys(value, IDENTITY_KEYS);
        let object = stripped.as_object().unwrap();
        assert!(!object.contains_key("id"));
        assert_eq!(object.get("url").unwrap(), "a");
        assert_eq!(object.get("name").unwrap(), "n");
    }
}
