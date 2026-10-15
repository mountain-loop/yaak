use serde::{Deserialize, Serialize};
use std::path::Path;
use yaak_proxy::DEFAULT_CAPTURE_BODY_LIMIT;

/// `settings.json` in the proxy data directory. Missing keys take their defaults.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProxySettings {
    pub port: u16,
    /// Whether the system proxy points at the engine while it runs.
    pub system_proxy: bool,
    /// Bytes of each request and response body stored per flow.
    pub capture_body_limit: usize,
}

impl Default for ProxySettings {
    fn default() -> Self {
        Self { port: 9090, system_proxy: false, capture_body_limit: DEFAULT_CAPTURE_BODY_LIMIT }
    }
}

impl ProxySettings {
    /// The settings at `path`, or the defaults when there is no file.
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read_to_string(path) {
            Ok(contents) => serde_json::from_str(&contents)
                .map_err(|e| format!("Invalid settings in {}: {e}", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(format!("Failed to read {}: {e}", path.display())),
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        let contents = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, contents)
            .map_err(|e| format!("Failed to write {}: {e}", path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_without_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let settings = ProxySettings::load(&dir.path().join("settings.json")).unwrap();
        assert_eq!(settings.port, 9090);
        assert!(!settings.system_proxy);
        assert_eq!(settings.capture_body_limit, 10 * 1024 * 1024);
    }

    #[test]
    fn defaults_for_missing_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"port": 8888}"#).unwrap();
        let settings = ProxySettings::load(&path).unwrap();
        assert_eq!(settings, ProxySettings { port: 8888, ..Default::default() });
    }

    #[test]
    fn round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = ProxySettings { port: 8080, system_proxy: true, capture_body_limit: 1024 };
        settings.save(&path).unwrap();
        assert_eq!(ProxySettings::load(&path).unwrap(), settings);

        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"port": 8080, "systemProxy": true, "captureBodyLimit": 1024})
        );
    }

    #[test]
    fn invalid_json_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{").unwrap();
        assert!(ProxySettings::load(&path).is_err());
    }
}
