//! JSON selection and discovery shared by assertions and host APIs. No I/O or plugin runtime.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use ts_rs::TS;

pub use serde_json_path::JsonPath;
pub const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_SELECTOR_BYTES: usize = 1024;
const MAX_CHILDREN: usize = 100;
const MAX_PARENTS: usize = 20;
const MAX_ARRAY_INDICES: usize = 20;

pub fn normalized_path(selector: &str) -> String {
    let s = selector.trim();
    if s.starts_with('$') {
        s.into()
    } else if s.starts_with('[') {
        format!("${s}")
    } else {
        format!("$.{s}")
    }
}

pub fn parse(selector: &str) -> Result<JsonPath, &'static str> {
    if selector.trim().is_empty() || selector.len() > MAX_SELECTOR_BYTES {
        return Err("Enter a valid JSONPath");
    }
    JsonPath::parse(&normalized_path(selector)).map_err(|_| "Enter a valid JSONPath")
}

pub fn parse_body(bytes: &[u8]) -> Result<Value, &'static str> {
    if bytes.len() > MAX_BODY_BYTES {
        return Err("Response body exceeds the 10 MiB limit");
    }
    serde_json::from_slice(bytes).map_err(|_| "Response body is not valid UTF-8 JSON")
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_jsonpath.ts")]
pub struct JsonPathChild {
    /// A single, escaped child accessor (e.g. .user, [0], or ["unusual.key"]).
    pub selector: String,
    pub label: String,
    pub kind: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_jsonpath.ts")]
pub struct JsonPathChildren {
    pub children: Vec<JsonPathChild>,
    /// Discovery is sampled/bounded, never an assertion that other keys don't exist.
    pub truncated: bool,
}

fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "text",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn key_selector(key: &str) -> String {
    let mut chars = key.chars();
    let first_ok = chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_');
    if first_ok && chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        format!(".{key}")
    } else {
        format!("[{}]", serde_json::to_string(key).expect("string is JSON serializable"))
    }
}

/// Enumerate just the next level. Wildcard parents sample up to 20 matches, merging keys/types.
/// Returns structure only; response values (possibly secrets) never appear in suggestions.
pub fn children(document: &Value, parent: &str) -> Result<JsonPathChildren, &'static str> {
    let query = parse(parent)?;
    let parents = query.query(document).all();
    let mut result =
        JsonPathChildren { truncated: parents.len() > MAX_PARENTS, ..Default::default() };
    let mut indices = BTreeMap::<String, usize>::new();
    for value in parents.into_iter().take(MAX_PARENTS) {
        let mut add = |selector: String, label: String, kind: &str| {
            if selector.len() + parent.len() > MAX_SELECTOR_BYTES {
                result.truncated = true;
                return;
            }
            if let Some(&index) = indices.get(&selector) {
                if result.children[index].kind != kind {
                    result.children[index].kind = "mixed".into();
                }
            } else if result.children.len() < MAX_CHILDREN {
                indices.insert(selector.clone(), result.children.len());
                result.children.push(JsonPathChild { selector, label, kind: kind.into() });
            } else {
                result.truncated = true;
            }
        };
        match value {
            Value::Object(object) => {
                for (key, value) in object {
                    add(key_selector(key), key.clone(), kind(value));
                }
            }
            Value::Array(array) => {
                if !array.is_empty() {
                    add("[*]".into(), "[*]".into(), "all items");
                }
                for (index, value) in array.iter().take(MAX_ARRAY_INDICES).enumerate() {
                    add(format!("[{index}]"), format!("[{index}]"), kind(value));
                }
                if array.len() > MAX_ARRAY_INDICES {
                    result.truncated = true;
                }
            }
            _ => {}
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn discovers_one_level_at_a_time_and_merges_wildcard_children() {
        let document = json!({"users": [{"name": "SECRET", "id": 1}, {"id": "two", "active": true}], "total": 2});
        let root = children(&document, "$").unwrap();
        assert_eq!(
            root.children.iter().map(|c| c.label.as_str()).collect::<Vec<_>>(),
            ["total", "users"]
        );
        assert!(!serde_json::to_string(&root).unwrap().contains("SECRET"));
        let users = children(&document, "users").unwrap();
        assert_eq!(
            users.children.iter().map(|c| c.selector.as_str()).collect::<Vec<_>>(),
            ["[*]", "[0]", "[1]"]
        );
        let fields = children(&document, "$.users[*]").unwrap();
        assert_eq!(fields.children.iter().find(|c| c.label == "id").unwrap().kind, "mixed");
        assert_eq!(fields.children.iter().find(|c| c.label == "active").unwrap().kind, "boolean");
        assert!(children(&document, "$.users[0].id").unwrap().children.is_empty());
        assert!(children(&document, "$.missing").unwrap().children.is_empty());
    }

    #[test]
    fn suggestions_round_trip_unusual_keys_without_interpreting_them() {
        for key in [
            "",
            "a.b",
            "space key",
            "quote\"key",
            "single'key",
            "back\\slash",
            "bracket]key",
            "*",
            "..",
            "$",
            "@number()",
            "line\nbreak\t\u{0}",
            "emoji 🤔",
            "__proto__",
            "constructor",
        ] {
            let document = json!({key: "needle", "decoy": "wrong"});
            let found = children(&document, "$")
                .unwrap()
                .children
                .into_iter()
                .find(|c| c.label == key)
                .unwrap();
            assert_eq!(
                parse(&format!("${}", found.selector)).unwrap().query(&document).all(),
                vec![&json!("needle")],
                "key {key:?}"
            );
        }
    }

    #[test]
    fn discovery_is_bounded_and_marks_sampling() {
        let document = json!((0..30).map(|i| json!({"id": i})).collect::<Vec<_>>());
        let items = children(&document, "$").unwrap();
        assert_eq!(items.children.len(), MAX_ARRAY_INDICES + 1);
        assert!(items.truncated);
        assert!(children(&document, "$[*]").unwrap().truncated);
        let many = Value::Object((0..110).map(|i| (format!("key{i}"), Value::Null)).collect());
        let result = children(&many, "$").unwrap();
        assert_eq!(result.children.len(), MAX_CHILDREN);
        assert!(result.truncated);
        assert!(parse_body(&vec![b' '; MAX_BODY_BYTES + 1]).is_err());
    }

    // Characterize the existing plugin's expressions before migrating its engine.
    #[test]
    fn standard_plugin_filters_work_but_javascript_extensions_are_not_supported() {
        let document = json!({"items": [{"id": 1}, {"id": 2}, {"id": 3}], "space key": 4});
        for (path, expected) in [
            ("$.items[1].id", json!([2])),
            ("$['space key']", json!([4])),
            ("$.items[*].id", json!([1, 2, 3])),
            ("$..id", json!([1, 2, 3])),
            ("$.items[0:2].id", json!([1, 2])),
            ("$.items[0,2].id", json!([1, 3])),
            ("$.items[?(@.id > 1)].id", json!([2, 3])),
            ("$.missing", json!([])),
        ] {
            assert_eq!(
                serde_json::to_value(parse(path).unwrap().query(&document).all()).unwrap(),
                expected,
                "{path}"
            );
        }
        assert!(parse("$.items[(@.length-1)].id").is_err());
        assert!(parse("$[\"items\"].$").is_err());
        // serde_json cannot represent the unpaired UTF-16 surrogate accepted by JS JSON.parse.
        assert!(parse_body(br#"{"\ud800":"value"}"#).is_err());
    }
}
