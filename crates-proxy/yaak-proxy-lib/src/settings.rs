use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;
use yaak_proxy::{
    BUILT_IN_EXCLUSIONS, BuiltInKind, DEFAULT_CAPTURE_BODY_LIMIT, DecryptEntry, DecryptPolicy,
};

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
    /// Whether captured traffic is cleared as the app or daemon launches or kept between
    /// launches. Missing, as in a file from before the choice, it is read from
    /// `keepTrafficBytes`: a cap set there means the traffic was meant to be kept.
    #[serde(default)]
    pub traffic: Option<TrafficRetention>,
    /// The most captured traffic kept, in bytes of the databases' used pages; the oldest flows
    /// are deleted past it. None keeps everything. Only applies while traffic is kept.
    pub keep_traffic_bytes: Option<u64>,
    /// The HTTP versions offered to clients in intercepted HTTPS.
    pub http_version: HttpVersion,
    /// The user's decrypt entries, in order: `host:api.example.com`, `app:Google Chrome`, `*`,
    /// `!host:*.bank.com`. Empty, so HTTPS is tunnelled, until hosts or apps are added. The
    /// built-in exclusions are not kept here; see [`Self::decrypt_list`].
    pub decrypt: Vec<String>,
    /// The built-in exclusions the user removed.
    pub decrypt_built_ins_removed: Vec<String>,
}

impl Default for ProxySettings {
    fn default() -> Self {
        Self {
            port: 9090,
            system_proxy_at_launch: true,
            capture_body_limit: DEFAULT_CAPTURE_BODY_LIMIT,
            traffic: Some(TrafficRetention::ClearOnLaunch),
            keep_traffic_bytes: None,
            http_version: HttpVersion::Auto,
            decrypt: Vec::new(),
            decrypt_built_ins_removed: Vec::new(),
        }
    }
}

/// What happens to captured traffic between launches.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum TrafficRetention {
    /// Emptied as the app or daemon launches, before anything reads it.
    #[default]
    ClearOnLaunch,
    /// Kept, under the keep-traffic cap when there is one.
    Keep,
}

/// One entry of the decrypt list, as the app shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct DecryptListEntry {
    /// As stored: `host:*.example.com`, `app:Google Chrome`, `!host:*.apple.com`, `*`.
    pub entry: String,
    /// Shipped with the app: an exclusion of Apple's services or a pinned app's hosts.
    pub built_in: bool,
    /// Why a built-in exclusion ships. None for the user's own entries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kind: Option<ExclusionKind>,
}

/// Why a built-in exclusion ships.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum ExclusionKind {
    /// Apple's own services, which macOS daemons reach with pinned certificates.
    Apple,
    /// The hosts of an app that pins its certificates.
    Pinned,
}

impl From<BuiltInKind> for ExclusionKind {
    fn from(kind: BuiltInKind) -> Self {
        match kind {
            BuiltInKind::Apple => Self::Apple,
            BuiltInKind::Pinned => Self::Pinned,
        }
    }
}

/// What HTTPS is decrypted: the user's entries in order, then the built-in exclusions not
/// removed. A connection is decrypted when a positive entry matches it and no exclusion does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct DecryptList {
    pub entries: Vec<DecryptListEntry>,
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
    /// Whether traffic is cleared at launch or kept. A file from before the choice keeps it
    /// when it has a keep-traffic cap, so an update doesn't delete a capture someone meant to
    /// keep.
    pub fn traffic(&self) -> TrafficRetention {
        self.traffic.unwrap_or(if self.keep_traffic_bytes.is_some() {
            TrafficRetention::Keep
        } else {
            TrafficRetention::ClearOnLaunch
        })
    }

    /// The keep-traffic cap, while traffic is kept. Cleared at launch, nothing is swept.
    pub fn keep_traffic_cap(&self) -> Option<u64> {
        match self.traffic() {
            TrafficRetention::Keep => self.keep_traffic_bytes,
            TrafficRetention::ClearOnLaunch => None,
        }
    }

    /// The user's entries, then the built-in exclusions they kept.
    pub fn decrypt_list(&self) -> DecryptList {
        let user = self.decrypt.iter().map(|e| DecryptListEntry {
            entry: e.clone(),
            built_in: false,
            kind: None,
        });
        let built_in = BUILT_IN_EXCLUSIONS
            .iter()
            .filter(|(e, _)| !self.decrypt_built_ins_removed.iter().any(|r| r == e))
            .map(|(e, kind)| DecryptListEntry {
                entry: e.to_string(),
                built_in: true,
                kind: Some((*kind).into()),
            });
        DecryptList { entries: user.chain(built_in).collect() }
    }

    /// Replaces the list with `entries`, as the user may type them: each is normalized, a bare
    /// hostname becoming `host:`, and repeats are dropped. A built-in exclusion left out is
    /// removed, and one written again is restored. Fails, changing nothing, on an entry that
    /// does not parse.
    pub fn set_decrypt_list<S: AsRef<str>>(&mut self, entries: &[S]) -> Result<(), String> {
        let mut user: Vec<String> = Vec::new();
        let mut kept_built_ins: Vec<String> = Vec::new();
        for entry in entries {
            let parsed = DecryptEntry::parse(entry.as_ref())?;
            let normalized = parsed.to_string();
            let list = if parsed.built_in { &mut kept_built_ins } else { &mut user };
            if !list.contains(&normalized) {
                list.push(normalized);
            }
        }
        self.decrypt = user;
        self.decrypt_built_ins_removed = BUILT_IN_EXCLUSIONS
            .iter()
            .filter(|(e, _)| !kept_built_ins.iter().any(|k| k == e))
            .map(|(e, _)| e.to_string())
            .collect();
        Ok(())
    }

    /// Removes `remove` from the list as it is and adds `add` after the user's own entries,
    /// each normalized, as [`Self::set_decrypt_list`] would take the result. A built-in removed
    /// is remembered as removed, and one added is restored. Fails, changing nothing, on an
    /// entry that does not parse.
    pub fn edit_decrypt_list<S: AsRef<str>>(
        &mut self,
        add: &[S],
        remove: &[S],
    ) -> Result<(), String> {
        let normalize = |e: &str| DecryptEntry::parse(e).ok().map(|p| p.to_string());
        let add = add
            .iter()
            .map(|e| DecryptEntry::parse(e.as_ref()).map(|p| p.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        // An entry goes as stored, so one edited by hand, odd case or malformed, can go too.
        let removed = |stored: &str| {
            remove.iter().any(|r| {
                let r = r.as_ref();
                r == stored || normalize(r).is_some_and(|r| Some(r) == normalize(stored))
            })
        };
        let mut entries: Vec<String> = self
            .decrypt_list()
            .entries
            .into_iter()
            .map(|e| e.entry)
            .filter(|e| !removed(e))
            .collect();
        entries.extend(add);
        self.set_decrypt_list(&entries)
    }

    /// The engine's policy from the list. An entry saved by hand that does not parse is left
    /// out, with a warning, rather than stopping the engine.
    pub fn decrypt_policy(&self) -> DecryptPolicy {
        let entries = self.decrypt_list().entries.into_iter().filter_map(|e| {
            DecryptEntry::parse(&e.entry)
                .inspect_err(|err| log::warn!("Ignoring decrypt entry: {err}"))
                .ok()
        });
        DecryptPolicy { entries: entries.collect() }
    }

    /// The settings at `path`, or the defaults when there is no file.
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read_to_string(path) {
            Ok(contents) => {
                let mut settings: Self = serde_json::from_str(&contents)
                    .map_err(|e| format!("Invalid settings in {}: {e}", path.display()))?;
                settings.traffic = Some(settings.traffic());
                Ok(settings)
            }
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
        assert_eq!(settings.keep_traffic_bytes, None, "no cap");
        assert_eq!(settings.traffic(), TrafficRetention::ClearOnLaunch);
    }

    #[test]
    fn a_file_from_before_the_choice_keeps_traffic_when_it_had_a_cap() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"port": 9090, "keepTrafficBytes": 1073741824}"#).unwrap();
        let settings = ProxySettings::load(&path).unwrap();
        assert_eq!(settings.traffic(), TrafficRetention::Keep);
        assert_eq!(settings.keep_traffic_cap(), Some(1 << 30));

        std::fs::write(&path, r#"{"port": 9090, "keepTrafficBytes": null}"#).unwrap();
        let settings = ProxySettings::load(&path).unwrap();
        assert_eq!(settings.traffic(), TrafficRetention::ClearOnLaunch);

        // Chosen once, the choice holds whatever the cap.
        std::fs::write(&path, r#"{"traffic": "clearOnLaunch", "keepTrafficBytes": 1024}"#).unwrap();
        let settings = ProxySettings::load(&path).unwrap();
        assert_eq!(settings.traffic(), TrafficRetention::ClearOnLaunch);
        assert_eq!(settings.keep_traffic_cap(), None, "the cap applies only while keeping");
        assert_eq!(settings.keep_traffic_bytes, Some(1024), "but is remembered");

        // Saved, the choice is written out, so setting a cap later doesn't change it.
        settings.save(&path).unwrap();
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(json["traffic"], "clearOnLaunch");
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
            traffic: Some(TrafficRetention::Keep),
            keep_traffic_bytes: Some(1 << 30),
            http_version: HttpVersion::Http1Only,
            decrypt: vec!["host:api.example.com".into()],
            decrypt_built_ins_removed: vec!["!host:*.zoom.us".into()],
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
                "traffic": "keep",
                "keepTrafficBytes": 1073741824,
                "httpVersion": "http1Only",
                "decrypt": ["host:api.example.com"],
                "decryptBuiltInsRemoved": ["!host:*.zoom.us"],
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
    fn the_decrypt_list_starts_with_only_the_built_in_exclusions() {
        let settings = ProxySettings::default();
        let list = settings.decrypt_list();
        assert!(!list.entries.is_empty());
        assert!(list.entries.iter().all(|e| e.built_in && e.entry.starts_with('!')));
        let policy = settings.decrypt_policy();
        assert!(!policy.decrypts_anything(), "nothing is decrypted by default");
    }

    #[test]
    fn setting_the_decrypt_list() {
        let mut settings = ProxySettings::default();
        let mut entries: Vec<String> = vec![
            "api.example.com".into(),
            "*".into(),
            "host:API.example.com".into(),
            "app:Google Chrome".into(),
        ];
        // Every built-in exclusion but zoom.us, kept.
        entries.extend(
            BUILT_IN_EXCLUSIONS
                .iter()
                .filter(|(e, _)| *e != "!host:*.zoom.us")
                .map(|(e, _)| e.to_string()),
        );
        settings.set_decrypt_list(&entries).unwrap();
        assert_eq!(settings.decrypt, ["host:api.example.com", "*", "app:Google Chrome"]);
        assert_eq!(settings.decrypt_built_ins_removed, ["!host:*.zoom.us"]);
        let list = settings.decrypt_list();
        assert_eq!(
            list.entries[0],
            DecryptListEntry { entry: "host:api.example.com".into(), built_in: false, kind: None }
        );
        assert!(list.entries[3].built_in);
        assert_eq!(list.entries[3].entry, "!host:*.apple.com");
        assert_eq!(list.entries[3].kind, Some(ExclusionKind::Apple));
        let onepassword = list.entries.iter().find(|e| e.entry == "!host:*.1password.com");
        assert_eq!(onepassword.unwrap().kind, Some(ExclusionKind::Pinned));
        assert!(!list.entries.iter().any(|e| e.entry == "!host:*.zoom.us"));

        // Written again, a built-in exclusion is restored.
        let mut again: Vec<String> = list.entries.iter().map(|e| e.entry.clone()).collect();
        again.push("!host:*.zoom.us".into());
        settings.set_decrypt_list(&again).unwrap();
        assert!(settings.decrypt_built_ins_removed.is_empty());

        // An invalid entry changes nothing.
        let before = settings.clone();
        assert!(settings.set_decrypt_list(&["host:a b"]).is_err());
        assert_eq!(settings, before);
    }

    #[test]
    fn editing_applies_to_the_list_as_it_is() {
        let mut settings =
            ProxySettings { decrypt: vec!["host:a.com".into()], ..Default::default() };
        // Two edits made from the same earlier copy both land.
        settings.edit_decrypt_list(&["b.com"], &[]).unwrap();
        settings.edit_decrypt_list(&["app:Slack"], &["host:a.com"]).unwrap();
        assert_eq!(settings.decrypt, ["host:b.com", "app:Slack"]);
        // A built-in removed and restored.
        settings.edit_decrypt_list(&[], &["!host:*.zoom.us"]).unwrap();
        assert_eq!(settings.decrypt_built_ins_removed, ["!host:*.zoom.us"]);
        settings.edit_decrypt_list(&["!host:*.zoom.us"], &[]).unwrap();
        assert!(settings.decrypt_built_ins_removed.is_empty());
        let before = settings.clone();
        assert!(settings.edit_decrypt_list(&["host:a b"], &[]).is_err());
        assert_eq!(settings, before);
    }

    #[test]
    fn entries_edited_by_hand_can_be_removed() {
        let mut settings = ProxySettings {
            decrypt: vec!["API.example.com".into(), "host:a b".into(), "b.com".into()],
            ..Default::default()
        };
        settings.edit_decrypt_list(&[], &["host:api.example.com", "host:a b"]).unwrap();
        assert_eq!(settings.decrypt, ["host:b.com"]);
    }

    #[test]
    fn a_hand_edited_entry_that_does_not_parse_is_skipped() {
        let settings = ProxySettings {
            decrypt: vec!["host:a b".into(), "x.com".into()],
            ..Default::default()
        };
        let policy = settings.decrypt_policy();
        assert_eq!(policy.entries.iter().filter(|e| !e.negated).count(), 1);
    }

    #[test]
    fn invalid_json_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{").unwrap();
        assert!(ProxySettings::load(&path).is_err());
    }
}
