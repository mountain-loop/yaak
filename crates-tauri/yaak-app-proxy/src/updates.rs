//! Yaak Proxy's update check. The prompt, download, install and relaunch are Yaak's, shared
//! through `yaak-updater`; what differs is where the proxy asks and what it accepts.
//!
//! The channel and update behavior are the shared settings tabs' values, which the window
//! keeps, so the window passes them with each check.
//!
//! A build without the `updater` feature, as development builds are, keeps the commands, which
//! say there is no updater, but uses none of the checking itself.
#![cfg_attr(not(feature = "updater"), allow(dead_code, unused_imports))]

use std::hash::BuildHasher;
use std::time::Instant;

use log::{info, warn};
use tauri::{Manager, Runtime, State, WebviewWindow};
use tokio::sync::Mutex;
use yaak_updater::{UpdateInstall, UpdateMode, UpdateTrigger, prompt_and_install};

/// Where Yaak Proxy asks for updates. The `/proxy/` segment tells the update server which app
/// is asking; Yaak asks at `/check/...` and its answers are unaffected. A server that doesn't
/// know the proxy yet answers 404, which is a failed check here, never Yaak's update.
pub const UPDATE_ENDPOINT: &str =
    "https://update.yaak.app/proxy/check/{{target}}/{{arch}}/{{current_version}}";

/// How every Yaak Proxy updater artifact's file name starts, as the release workflow uploads
/// it. An update whose file is named otherwise, such as Yaak's own `Yaak_aarch64.app.tar.gz`,
/// is refused: it is signed by the same key, so the signature alone would let it replace the
/// proxy with Yaak.
pub const ARTIFACT_PREFIX: &str = "Yaak.Proxy_";

/// The file in the app's data directory holding the random key the update server buckets
/// gradual rollouts by, so a Mac keeps its place in a rollout.
const UPDATE_KEY_FILE: &str = "update-key";

/// When the last check ran, so background checks keep to their channel's interval.
#[derive(Default)]
pub struct ProxyUpdater {
    last_check: Option<Instant>,
}

/// Whether this build has the updater, so the window shows its settings and menu item.
#[tauri::command]
pub fn cmd_updater_enabled() -> bool {
    cfg!(feature = "updater")
}

/// Asks the update server for a newer Yaak Proxy on `channel` and, when there is one, offers
/// it in this window. True when an update was found. A background check returns false at once
/// when the channel's interval since the last check hasn't passed.
#[tauri::command]
pub async fn cmd_check_for_updates<R: Runtime>(
    window: WebviewWindow<R>,
    updater: State<'_, Mutex<ProxyUpdater>>,
    channel: String,
    background: bool,
    auto_download: bool,
) -> Result<bool, String> {
    let mode = UpdateMode::new(&channel);
    let trigger = if background { UpdateTrigger::Background } else { UpdateTrigger::User };
    let mut updater = updater.lock().await;
    if trigger == UpdateTrigger::Background
        && let Some(last) = updater.last_check
        && last.elapsed() < mode.check_interval()
    {
        return Ok(false);
    }
    updater.last_check = Some(Instant::now());
    drop(updater);
    check(&window, mode, trigger, auto_download).await
}

/// Relaunches the app after an update installed, through LaunchServices on macOS.
#[tauri::command]
pub fn cmd_restart<R: Runtime>(app_handle: tauri::AppHandle<R>) {
    yaak_updater::restart::request_restart(&app_handle);
}

#[cfg(feature = "updater")]
async fn check<R: Runtime>(
    window: &WebviewWindow<R>,
    mode: UpdateMode,
    trigger: UpdateTrigger,
    auto_download: bool,
) -> Result<bool, String> {
    use tauri_plugin_updater::UpdaterExt;

    info!("Checking for updates mode={mode} trigger={}", trigger.header_value());
    let endpoint = tauri::Url::parse(&endpoint()).map_err(|e| e.to_string())?;
    let update = window
        .updater_builder()
        .endpoints(vec![endpoint])
        .and_then(|b| b.header("X-Update-Mode", mode.to_string()))
        .and_then(|b| b.header("X-Update-Key", update_key(window)))
        .and_then(|b| b.header("X-Update-Trigger", trigger.header_value()))
        .and_then(|b| b.header("X-Install-Mode", "unknown"))
        .and_then(|b| b.build())
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    let Some(update) = update else {
        return Ok(false);
    };
    let file = artifact_file_name(update.download_url.path());
    if !is_proxy_artifact(file) {
        warn!(
            "Refused update {} at {}: not a Yaak Proxy artifact",
            update.version, update.download_url
        );
        return Err(format!("The update server offered {file}, which is not a Yaak Proxy update"));
    }

    let w = window.clone();
    tauri::async_runtime::spawn(async move {
        prompt_and_install(&w, &update, trigger, auto_download, UpdateInstall::Integrated).await;
    });
    Ok(true)
}

#[cfg(not(feature = "updater"))]
async fn check<R: Runtime>(
    _window: &WebviewWindow<R>,
    _mode: UpdateMode,
    _trigger: UpdateTrigger,
    _auto_download: bool,
) -> Result<bool, String> {
    Err("This build of Yaak Proxy has no updater".to_string())
}

/// Where checks go: [`UPDATE_ENDPOINT`], or, in a debug build only, `YAAK_PROXY_UPDATE_ENDPOINT`
/// when it is set, to try the flow against a local server.
#[cfg(feature = "updater")]
fn endpoint() -> String {
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("YAAK_PROXY_UPDATE_ENDPOINT")
        && !url.is_empty()
    {
        warn!("Checking for updates at {url}, from YAAK_PROXY_UPDATE_ENDPOINT");
        return url;
    }
    UPDATE_ENDPOINT.to_string()
}

/// The last segment of a download URL's path.
fn artifact_file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Whether a file is one of the proxy's updater artifacts, by the name the release gives it.
fn is_proxy_artifact(file: &str) -> bool {
    file.starts_with(ARTIFACT_PREFIX)
}

/// This Mac's update key, made once and kept in the data directory. Without one, the server
/// buckets by address, which is still deterministic, so a failure here is only logged.
fn update_key<R: Runtime>(window: &WebviewWindow<R>) -> String {
    let Ok(dir) = window.path().app_data_dir() else {
        return String::new();
    };
    let path = dir.join(UPDATE_KEY_FILE);
    if let Ok(key) = std::fs::read_to_string(&path)
        && !key.trim().is_empty()
    {
        return key.trim().to_string();
    }
    // Random per process: each `RandomState` is seeded afresh
    let random = || std::collections::hash_map::RandomState::new().hash_one(std::process::id());
    let key = format!("{:016x}{:016x}", random(), random());
    if let Err(e) = std::fs::create_dir_all(&dir) {
        warn!("Failed to create the data directory for the update key: {e}");
    }
    if let Err(e) = std::fs::write(&path, &key) {
        warn!("Failed to save the update key: {e}");
    }
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The endpoint is the update server's, with the proxy's own path, so Yaak's is untouched.
    #[test]
    fn the_endpoint_is_the_proxys_own() {
        let url = tauri::Url::parse(UPDATE_ENDPOINT).unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("update.yaak.app"));
        assert!(url.path().starts_with("/proxy/check/"), "{}", url.path());
    }

    /// Only the proxy's artifacts install, never Yaak's, which the same key signs.
    #[test]
    fn only_proxy_artifacts_are_accepted() {
        let base = "/mountain-loop/yaak/releases/download/v2026.11.0/";
        for (file, ok) in [
            ("Yaak.Proxy_aarch64.app.tar.gz", true),
            ("Yaak.Proxy_x64.app.tar.gz", true),
            ("Yaak_aarch64.app.tar.gz", false),
            ("Yaak_x64.app.tar.gz", false),
            ("Yaak.app.tar.gz", false),
        ] {
            let name = artifact_file_name(&format!("{base}{file}")).to_string();
            assert_eq!(name, file);
            assert_eq!(is_proxy_artifact(&name), ok, "{file}");
        }
    }

    /// The release config carries the updater's key but not its endpoint, which is
    /// [`UPDATE_ENDPOINT`] alone, and builds the updater artifacts; it never turns on a license.
    #[test]
    fn the_release_config_has_the_updater_and_no_license() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.release.conf.json")).unwrap();
        let features: Vec<&str> = config["build"]["features"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|f| f.as_str())
            .collect();
        assert!(features.contains(&"updater"), "{features:?}");
        assert!(!features.contains(&"license"), "{features:?}");
        assert!(config["plugins"]["updater"]["pubkey"].as_str().is_some_and(|k| !k.is_empty()));
        assert!(config["plugins"]["updater"].get("endpoints").is_none());
        assert_eq!(config["bundle"]["createUpdaterArtifacts"], serde_json::json!(true));
    }

    /// The proxy verifies updates with the key Yaak's release signs them with.
    #[test]
    fn the_updater_key_is_yaaks() {
        let proxy: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.release.conf.json")).unwrap();
        let client: serde_json::Value =
            serde_json::from_str(include_str!("../../yaak-app-client/tauri.release.conf.json"))
                .unwrap();
        assert_eq!(proxy["plugins"]["updater"]["pubkey"], client["plugins"]["updater"]["pubkey"]);
    }
}
