use serde_json::Value;
use std::collections::BTreeMap;

pub fn get_bool(v: &Value, key: &str, fallback: bool) -> bool {
    match v.get(key) {
        None => fallback,
        Some(v) => v.as_bool().unwrap_or(fallback),
    }
}

pub fn get_str<'a>(v: &'a Value, key: &str) -> &'a str {
    match v.get(key) {
        None => "",
        Some(v) => v.as_str().unwrap_or_default(),
    }
}

pub fn get_str_map<'a>(v: &'a BTreeMap<String, Value>, key: &str) -> &'a str {
    match v.get(key) {
        None => "",
        Some(v) => v.as_str().unwrap_or_default(),
    }
}
