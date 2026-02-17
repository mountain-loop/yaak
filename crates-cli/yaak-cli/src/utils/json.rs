use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

pub fn is_json_shorthand(input: &str) -> bool {
    input.trim_start().starts_with('{')
}

pub fn parse_json_object(raw: &str, context: &str) -> Value {
    let value: Value = serde_json::from_str(raw)
        .unwrap_or_else(|error| panic!("Invalid JSON for {context}: {error}"));

    if !value.is_object() {
        panic!("JSON payload for {context} must be an object");
    }

    value
}

pub fn parse_optional_json(
    json_flag: Option<String>,
    json_shorthand: Option<String>,
    context: &str,
) -> Option<Value> {
    match (json_flag, json_shorthand) {
        (Some(_), Some(_)) => {
            panic!("Cannot provide both --json and positional JSON for {context}")
        }
        (Some(raw), None) => Some(parse_json_object(&raw, context)),
        (None, Some(raw)) => Some(parse_json_object(&raw, context)),
        (None, None) => None,
    }
}

pub fn parse_required_json(
    json_flag: Option<String>,
    json_shorthand: Option<String>,
    context: &str,
) -> Value {
    parse_optional_json(json_flag, json_shorthand, context).unwrap_or_else(|| {
        panic!("Missing JSON payload for {context}. Use --json or positional JSON")
    })
}

pub fn require_id(payload: &Value, context: &str) -> String {
    payload
        .get("id")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| panic!("{context} requires a non-empty \"id\" field"))
}

pub fn validate_create_id(payload: &Value, context: &str) {
    let Some(id_value) = payload.get("id") else {
        return;
    };

    match id_value {
        Value::String(id) if id.is_empty() => {}
        _ => panic!("{context} create JSON must omit \"id\" or set it to an empty string"),
    }
}

pub fn apply_merge_patch<T>(existing: &T, patch: &Value, id: &str, context: &str) -> T
where
    T: Serialize + DeserializeOwned,
{
    let mut base = serde_json::to_value(existing).unwrap_or_else(|error| {
        panic!("Failed to serialize existing model for {context}: {error}")
    });
    merge_patch(&mut base, patch);

    let Some(base_object) = base.as_object_mut() else {
        panic!("Merged payload for {context} must be an object");
    };
    base_object.insert("id".to_string(), Value::String(id.to_string()));

    serde_json::from_value(base).unwrap_or_else(|error| {
        panic!("Failed to deserialize merged payload for {context}: {error}")
    })
}

fn merge_patch(target: &mut Value, patch: &Value) {
    match patch {
        Value::Object(patch_map) => {
            if !target.is_object() {
                *target = Value::Object(Map::new());
            }

            let target_map =
                target.as_object_mut().expect("merge_patch target expected to be object");

            for (key, patch_value) in patch_map {
                if patch_value.is_null() {
                    target_map.remove(key);
                    continue;
                }

                let target_entry = target_map.entry(key.clone()).or_insert(Value::Null);
                merge_patch(target_entry, patch_value);
            }
        }
        _ => {
            *target = patch.clone();
        }
    }
}
