use log::error;

pub(crate) fn collect_any_types(json: &str, out: &mut Vec<String>) {
    let value = match serde_json::from_str(json).map_err(|e| e.to_string()) {
        Ok(v) => v,
        Err(e) => {
            error!("Failed to parse gRPC message JSON: {e:?}");
            return;
        }
    };
    collect_any_types_value(&value, out);
}

fn collect_any_types_value(json: &serde_json::Value, out: &mut Vec<String>) {
    match json {
        serde_json::Value::Object(map) => {
            if let Some(t) = map.get("@type").and_then(|v| v.as_str()) {
                if let Some(full_name) = t.rsplit_once('/').map(|(_, n)| n) {
                    out.push(full_name.to_string());
                }
            }

            for v in map.values() {
                collect_any_types_value(v, out);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                collect_any_types_value(v, out);
            }
        }
        _ => {}
    }
}

// Write tests for this
#[cfg(test)]
mod tests {
    #[test]
    fn test_collect_any_types() {
        let json = r#"{
            "mounts": [
              {
                "mountSource": {
                  "@type": "type.googleapis.com/mount_source.MountSourceRBDVolume",
                  "volumeID": "volumes/rbd"
                }
              }
            ],
            "foo": {
              "@type": "type.googleapis.com/foo.bar",
              "foo": "fooo"
            }
        }"#;

        let mut out = Vec::new();
        super::collect_any_types(json, &mut out);
        assert_eq!(out, vec!["foo.bar", "mount_source.MountSourceRBDVolume"]);
    }
}
