use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;
use yaak_proxy::DEFAULT_CAPTURE_BODY_LIMIT;

/// `settings.json` in the proxy data directory. Missing keys take their defaults.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProxySettings {
    pub port: u16,
    /// Point this Mac's web traffic at the engine as it starts. It is turned off again as the
    /// engine stops, and can be turned on and off any time between. Read from the earlier
    /// `systemProxy` too, so a saved choice to keep it off carries over.
    #[serde(alias = "systemProxy")]
    pub system_proxy_at_launch: bool,
    /// Bytes of each request and response body stored per flow.
    pub capture_body_limit: usize,
    /// The HTTP versions offered to clients in intercepted HTTPS.
    pub http_version: HttpVersion,
}

impl Default for ProxySettings {
    fn default() -> Self {
        Self {
            port: 9090,
            system_proxy_at_launch: true,
            capture_body_limit: DEFAULT_CAPTURE_BODY_LIMIT,
            http_version: HttpVersion::Auto,
        }
    }
}

/// The HTTP versions offered to clients in intercepted HTTPS. Upstream, the engine speaks
/// whichever the server picks either way.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum HttpVersion {
    /// HTTP/2 or HTTP/1.1, as the client prefers.
    #[default]
    Auto,
    /// HTTP/1.1 alone, for clients that misbehave on HTTP/2.
    Http1Only,
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
        assert!(settings.system_proxy_at_launch);
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
        let settings = ProxySettings {
            port: 8080,
            system_proxy_at_launch: false,
            capture_body_limit: 1024,
            http_version: HttpVersion::Http1Only,
        };
        settings.save(&path).unwrap();
        assert_eq!(ProxySettings::load(&path).unwrap(), settings);

        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "port": 8080,
                "systemProxyAtLaunch": false,
                "captureBodyLimit": 1024,
                "httpVersion": "http1Only",
            })
        );
    }

    #[test]
    fn http_version_defaults_to_auto() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"port": 8888}"#).unwrap();
        assert_eq!(ProxySettings::load(&path).unwrap().http_version, HttpVersion::Auto);
        std::fs::write(&path, r#"{"httpVersion": "auto"}"#).unwrap();
        assert_eq!(ProxySettings::load(&path).unwrap().http_version, HttpVersion::Auto);
    }

    #[test]
    fn the_earlier_system_proxy_key_carries_over() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"port": 9090, "systemProxy": false}"#).unwrap();
        assert!(!ProxySettings::load(&path).unwrap().system_proxy_at_launch);
        std::fs::write(&path, r#"{"systemProxy": true}"#).unwrap();
        assert!(ProxySettings::load(&path).unwrap().system_proxy_at_launch);

        // Saved again under the new key only.
        let settings = ProxySettings { system_proxy_at_launch: false, ..Default::default() };
        settings.save(&path).unwrap();
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(json["systemProxyAtLaunch"], false);
        assert!(json.get("systemProxy").is_none());
    }

    #[test]
    fn invalid_json_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{").unwrap();
        assert!(ProxySettings::load(&path).is_err());
    }
}
