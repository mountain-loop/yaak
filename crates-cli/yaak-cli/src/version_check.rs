use crate::ui;
use crate::version;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use yaak_api::{ApiClientKind, yaak_api_client};

const CACHE_FILE_NAME: &str = "cli-version-check.json";
const CHECK_INTERVAL_SECS: u64 = 24 * 60 * 60;
const REQUEST_TIMEOUT: Duration = Duration::from_millis(800);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct VersionCheckResponse {
    outdated: bool,
    latest_version: Option<String>,
    upgrade_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct CacheRecord {
    checked_at_epoch_secs: u64,
    response: VersionCheckResponse,
    last_warned_at_epoch_secs: Option<u64>,
    last_warned_version: Option<String>,
}

impl Default for CacheRecord {
    fn default() -> Self {
        Self {
            checked_at_epoch_secs: 0,
            response: VersionCheckResponse::default(),
            last_warned_at_epoch_secs: None,
            last_warned_version: None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionCheckRequest<'a> {
    current_version: &'a str,
    channel: String,
    install_source: String,
    platform: &'a str,
    arch: &'a str,
}

pub async fn maybe_check_for_updates() {
    if should_skip_check() {
        return;
    }

    let now = unix_epoch_secs();
    let cache_path = cache_path();
    let cached = read_cache(&cache_path);

    if let Some(cache) = cached.as_ref().filter(|c| !is_expired(c.checked_at_epoch_secs, now)) {
        let mut record = cache.clone();
        maybe_warn_outdated(&mut record, now);
        write_cache(&cache_path, &record);
        return;
    }

    let fresh = fetch_version_check().await;
    match fresh {
        Some(response) => {
            let mut record = CacheRecord {
                checked_at_epoch_secs: now,
                response: response.clone(),
                last_warned_at_epoch_secs: cached
                    .as_ref()
                    .and_then(|c| c.last_warned_at_epoch_secs),
                last_warned_version: cached.as_ref().and_then(|c| c.last_warned_version.clone()),
            };
            maybe_warn_outdated(&mut record, now);
            write_cache(&cache_path, &record);
        }
        None => {
            let fallback = cached.as_ref().map(|cache| cache.response.clone()).unwrap_or_default();
            let mut record = CacheRecord {
                checked_at_epoch_secs: now,
                response: fallback,
                last_warned_at_epoch_secs: cached
                    .as_ref()
                    .and_then(|c| c.last_warned_at_epoch_secs),
                last_warned_version: cached.as_ref().and_then(|c| c.last_warned_version.clone()),
            };
            maybe_warn_outdated(&mut record, now);
            write_cache(&cache_path, &record);
        }
    }
}

fn should_skip_check() -> bool {
    if std::env::var("YAAK_CLI_NO_UPDATE_CHECK")
        .is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
    {
        return true;
    }

    if std::env::var("CI").is_ok() {
        return true;
    }

    !std::io::stdout().is_terminal()
}

async fn fetch_version_check() -> Option<VersionCheckResponse> {
    let api_url = format!("{}/cli/check", update_base_url());
    let current_version = version::cli_version();
    let payload = VersionCheckRequest {
        current_version,
        channel: release_channel(current_version),
        install_source: install_source(),
        platform: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    };

    let client = yaak_api_client(ApiClientKind::Cli, current_version).ok()?;
    let request = client.post(api_url).json(&payload);

    let response = tokio::time::timeout(REQUEST_TIMEOUT, request.send()).await.ok()?.ok()?;
    if !response.status().is_success() {
        return None;
    }

    tokio::time::timeout(REQUEST_TIMEOUT, response.json::<VersionCheckResponse>()).await.ok()?.ok()
}

fn release_channel(version: &str) -> String {
    version
        .split_once('-')
        .and_then(|(_, suffix)| suffix.split('.').next())
        .unwrap_or("stable")
        .to_string()
}

fn install_source() -> String {
    std::env::var("YAAK_CLI_INSTALL_SOURCE")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "source".to_string())
}

fn update_base_url() -> &'static str {
    match std::env::var("ENVIRONMENT").ok().as_deref() {
        Some("development") => "http://localhost:9444",
        _ => "https://update.yaak.app",
    }
}

fn maybe_warn_outdated(record: &mut CacheRecord, now: u64) {
    if !record.response.outdated {
        return;
    }

    let latest =
        record.response.latest_version.clone().unwrap_or_else(|| "a newer release".to_string());
    let warn_suppressed = record.last_warned_version.as_deref() == Some(latest.as_str())
        && record.last_warned_at_epoch_secs.is_some_and(|t| !is_expired(t, now));
    if warn_suppressed {
        return;
    }

    let hint = record.response.upgrade_hint.clone().unwrap_or_else(default_upgrade_hint);
    ui::warning_stderr(&format!("A newer Yaak CLI version is available ({latest}). {hint}"));
    record.last_warned_version = Some(latest);
    record.last_warned_at_epoch_secs = Some(now);
}

fn default_upgrade_hint() -> String {
    if install_source() == "npm" {
        let channel = release_channel(version::cli_version());
        if channel == "stable" {
            return "Run `npm install -g @yaakapp/cli@latest` to update.".to_string();
        }
        return format!("Run `npm install -g @yaakapp/cli@{channel}` to update.");
    }

    "Update your Yaak CLI installation to the latest release.".to_string()
}

fn cache_path() -> PathBuf {
    std::env::temp_dir().join("yaak-cli").join(format!("{}-{CACHE_FILE_NAME}", environment_name()))
}

fn environment_name() -> &'static str {
    match std::env::var("ENVIRONMENT").ok().as_deref() {
        Some("staging") => "staging",
        Some("development") => "development",
        _ => "production",
    }
}

fn read_cache(path: &Path) -> Option<CacheRecord> {
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str::<CacheRecord>(&contents).ok()
}

fn write_cache(path: &Path, record: &CacheRecord) {
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(json) = serde_json::to_string(record) else {
        return;
    };
    let _ = fs::write(path, json);
}

fn is_expired(checked_at_epoch_secs: u64, now: u64) -> bool {
    now.saturating_sub(checked_at_epoch_secs) >= CHECK_INTERVAL_SECS
}

fn unix_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs()
}
