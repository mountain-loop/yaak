use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

type JsonResult<T> = std::result::Result<T, String>;

pub fn is_json_shorthand(input: &str) -> bool {
    input.trim_start().starts_with('{')
}

pub fn parse_json_object(raw: &str, context: &str) -> JsonResult<Value> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|error| format!("Invalid JSON for {context}: {error}"))?;

    if !value.is_object() {
        return Err(format!("JSON payload for {context} must be an object"));
    }

    Ok(value)
}

pub fn parse_optional_json(
    json_flag: Option<String>,
    json_shorthand: Option<String>,
    context: &str,
) -> JsonResult<Option<Value>> {
    match (json_flag, json_shorthand) {
        (Some(_), Some(_)) => Err(format!(
            "Cannot provide both --json and positional JSON for {context}"
        )),
        (Some(raw), None) => parse_json_object(&raw, context).map(Some),
        (None, Some(raw)) => parse_json_object(&raw, context).map(Some),
        (None, None) => Ok(None),
    }
}

pub fn parse_required_json(
    json_flag: Option<String>,
    json_shorthand: Option<String>,
    context: &str,
) -> JsonResult<Value> {
    parse_optional_json(json_flag, json_shorthand, context)?.ok_or_else(|| {
        format!("Missing JSON payload for {context}. Use --json or positional JSON")
    })
}

pub fn require_id(payload: &Value, context: &str) -> JsonResult<String> {
    payload
        .get("id")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .ok_or_else(|| format!("{context} requires a non-empty \"id\" field"))
}

pub fn validate_create_id(payload: &Value, context: &str) -> JsonResult<()> {
    let Some(id_value) = payload.get("id") else {
        return Ok(());
    };

    match id_value {
        Value::String(id) if id.is_empty() => Ok(()),
        _ => Err(format!(
            "{context} create JSON must omit \"id\" or set it to an empty string"
        )),
    }
}

pub fn apply_merge_patch<T>(existing: &T, patch: &Value, id: &str, context: &str) -> JsonResult<T>
where
    T: Serialize + DeserializeOwned,
{
    let mut base = serde_json::to_value(existing)
        .map_err(|error| format!("Failed to serialize existing model for {context}: {error}"))?;
    merge_patch(&mut base, patch);

    let Some(base_object) = base.as_object_mut() else {
        return Err(format!("Merged payload for {context} must be an object"));
    };
    base_object.insert("id".to_string(), Value::String(id.to_string()));

    serde_json::from_value(base)
        .map_err(|error| format!("Failed to deserialize merged payload for {context}: {error}"))
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
