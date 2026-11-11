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
use yaak_updater::{UpdateGate, UpdateInstall, UpdateMode, UpdateTrigger};

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

    // One check and one update at a time, whichever window or trigger asks
    let token = match window.state::<UpdateGate>().begin_check() {
        Ok(token) => token,
        Err(busy) => {
            info!("Not checking for updates: the update is {:?}", busy.state);
            if trigger == UpdateTrigger::User {
                busy.show(window);
                return Ok(true);
            }
            return Ok(false);
        }
    };

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

    token.offer(window, update, trigger, auto_download, UpdateInstall::Integrated);
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
    // Tests leave the data directory alone; a mock app's would be Application Support itself
    if cfg!(test) {
        return "test".to_string();
    }
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

/// The checks every trigger makes (launch, focus, the menu, Settings), raced against a local
/// update server through a mock app with the real updater plugin.
#[cfg(all(test, feature = "updater"))]
mod race_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};
    use tauri::{Emitter, Listener, WebviewUrl, WebviewWindowBuilder};

    /// A local update server that always offers 99.0.0 as a proxy artifact. Returns its port.
    fn serve_update() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut request = [0u8; 4096];
                let _ = stream.read(&mut request);
                if String::from_utf8_lossy(&request).contains(".app.tar.gz") {
                    // A slow download, to check while it runs. Not a real archive, so the
                    // install then fails its signature check and the run ends.
                    std::thread::sleep(Duration::from_millis(1500));
                    let body = "not an archive";
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    continue;
                }
                let body = format!(
                    r#"{{"version":"99.0.0","url":"http://127.0.0.1:{port}/Yaak.Proxy_aarch64.app.tar.gz","signature":"unused"}}"#
                );
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        port
    }

    /// Where a test app keeps its downloads, removed after each test.
    const TEST_IDENTIFIER: &str = "app.yaak.proxy.updates-test";

    /// One test at a time, since they share the endpoint variable and the downloads directory.
    fn serial() -> std::sync::MutexGuard<'static, ()> {
        static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());
        SERIAL.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn mock_app(port: u16) -> tauri::App<MockRuntime> {
        // SAFETY: only this module's tests read or write it, one at a time
        unsafe {
            std::env::set_var(
                "YAAK_PROXY_UPDATE_ENDPOINT",
                format!(
                    "http://127.0.0.1:{port}/proxy/check/{{{{target}}}}/{{{{arch}}}}/{{{{current_version}}}}"
                ),
            );
        }
        let mut context = mock_context(noop_assets());
        context.config_mut().identifier = TEST_IDENTIFIER.to_string();
        context.config_mut().plugins.0.insert(
            "updater".to_string(),
            serde_json::json!({ "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEVGRkFGMjQxRUNEOTQ3MzAKUldRd1I5bnNRZkw2NzRtMnRlWTN3R24xYUR3aGRsUjJzWGwvdHdEcGljb3ZJMUNlMjFsaHlqVU4K" }),
        );
        mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .manage(Mutex::new(ProxyUpdater::default()))
            .manage(UpdateGate::default())
            .build(context)
            .unwrap()
    }

    /// Removes the test app's downloads once the test ends, passing or not.
    struct CleanUp(tauri::AppHandle<MockRuntime>);

    impl Drop for CleanUp {
        fn drop(&mut self) {
            if let Ok(dir) = self.0.path().app_cache_dir()
                && dir.ends_with(TEST_IDENTIFIER)
            {
                let _ = std::fs::remove_dir_all(dir);
            }
        }
    }

    fn window(app: &tauri::App<MockRuntime>, label: &str) -> WebviewWindow<MockRuntime> {
        WebviewWindowBuilder::new(app, label, WebviewUrl::default()).build().unwrap()
    }

    /// Something the app showed a window about its update.
    #[derive(Debug, Clone)]
    struct Shown {
        window: String,
        event: &'static str,
        payload: serde_json::Value,
    }

    /// Records what the app shows each of `windows` about its update.
    fn record(windows: &[&WebviewWindow<MockRuntime>]) -> mpsc::Receiver<Shown> {
        let (tx, rx) = mpsc::channel();
        for w in windows {
            for event in [
                yaak_updater::UPDATE_AVAILABLE_EVENT,
                yaak_updater::UPDATE_STATE_EVENT,
                yaak_updater::UPDATE_INSTALLED_EVENT,
            ] {
                let tx = tx.clone();
                let window = w.label().to_string();
                w.listen(event, move |e| {
                    let payload = serde_json::from_str(e.payload()).unwrap();
                    let _ = tx.send(Shown { window: window.clone(), event, payload });
                });
            }
        }
        rx
    }

    /// Everything shown until nothing more comes for a moment, well inside the 3 seconds a
    /// prompt waits for its window to answer.
    fn drain(rx: &mpsc::Receiver<Shown>) -> Vec<Shown> {
        let mut all = Vec::new();
        while let Ok(shown) = rx.recv_timeout(Duration::from_millis(700)) {
            all.push(shown);
        }
        all
    }

    fn prompts(shown: &[Shown]) -> Vec<&Shown> {
        shown.iter().filter(|s| s.event == yaak_updater::UPDATE_AVAILABLE_EVENT).collect()
    }

    fn reply_id(prompt: &Shown) -> String {
        prompt.payload["replyEventId"].as_str().unwrap().to_string()
    }

    /// Answers a prompt as its window's buttons do.
    fn answer(app: &tauri::App<MockRuntime>, reply: &str, response: serde_json::Value) {
        app.emit(reply, response).unwrap();
    }

    fn ack(app: &tauri::App<MockRuntime>, reply: &str) {
        answer(app, reply, serde_json::json!({ "type": "ack" }));
    }

    fn user_check(window: &WebviewWindow<MockRuntime>) -> Result<bool, String> {
        tauri::async_runtime::block_on(check(window, UpdateMode::Beta, UpdateTrigger::User, false))
    }

    fn background_check(window: &WebviewWindow<MockRuntime>) -> Result<bool, String> {
        tauri::async_runtime::block_on(check(
            window,
            UpdateMode::Beta,
            UpdateTrigger::Background,
            false,
        ))
    }

    /// Waits for the gate to come back to idle, as a run ends.
    fn wait_for_idle(app: &tauri::App<MockRuntime>) {
        let gate = app.state::<UpdateGate>();
        for _ in 0..100 {
            if gate.state() == yaak_updater::UpdateState::Idle {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("the update run never ended: {:?}", gate.state());
    }

    /// The main window and Settings each check, as their Check for Updates… and Settings button
    /// do, at the same moment: only one prompt, and so one download and install, may start. The
    /// other window is told a check is under way.
    #[test]
    fn overlapping_checks_from_two_windows_start_one_update() {
        let _serial = serial();
        let app = mock_app(serve_update());
        let _clean = CleanUp(app.handle().clone());
        let main = window(&app, "main_0");
        let settings = window(&app, "settings");
        let rx = record(&[&main, &settings]);

        let state = app.state::<Mutex<ProxyUpdater>>();
        let (a, b) = tauri::async_runtime::block_on(async {
            tokio::join!(
                cmd_check_for_updates(main.clone(), state.clone(), "beta".into(), false, false),
                cmd_check_for_updates(settings.clone(), state.clone(), "beta".into(), false, false),
            )
        });
        let shown = drain(&rx);
        // Settle every prompt, so no task is left waiting on a window
        for prompt in prompts(&shown) {
            answer(
                &app,
                &reply_id(prompt),
                serde_json::json!({ "type": "action", "action": "skip" }),
            );
        }
        assert_eq!(a, Ok(true));
        assert_eq!(b, Ok(true));
        let started = prompts(&shown);
        assert_eq!(started.len(), 1, "two checks started {} prompts: {shown:?}", started.len());
        let told: Vec<_> =
            shown.iter().filter(|s| s.event == yaak_updater::UPDATE_STATE_EVENT).collect();
        assert_eq!(told.len(), 1, "{shown:?}");
        assert_eq!(told[0].payload, serde_json::json!({ "state": "checking" }));
        assert_ne!(told[0].window, started[0].window, "the window that lost the race is told");
        wait_for_idle(&app);
    }

    /// A check from another window, or a later background check, while a prompt waits on the
    /// user shows that same prompt, answered by the same run, rather than starting another.
    #[test]
    fn a_check_while_a_prompt_waits_shows_the_same_prompt() {
        let _serial = serial();
        let app = mock_app(serve_update());
        let _clean = CleanUp(app.handle().clone());
        let main = window(&app, "main_0");
        let settings = window(&app, "settings");
        let rx = record(&[&main, &settings]);

        assert_eq!(user_check(&main), Ok(true));
        let first = drain(&rx);
        assert_eq!(prompts(&first).len(), 1, "{first:?}");
        let reply = reply_id(prompts(&first)[0]);
        ack(&app, &reply);

        // The Settings button, then a background check as the main window comes forward
        assert_eq!(user_check(&settings), Ok(true));
        assert_eq!(background_check(&main), Ok(true));
        let again = drain(&rx);
        let shown_again = prompts(&again);
        assert_eq!(shown_again.len(), 2, "{again:?}");
        assert_eq!(shown_again[0].window, "settings");
        assert_eq!(shown_again[1].window, "main_0");
        for prompt in &shown_again {
            assert_eq!(reply_id(prompt), reply, "the same run answers it");
        }

        answer(&app, &reply, serde_json::json!({ "type": "action", "action": "skip" }));
        wait_for_idle(&app);
    }

    /// While the update downloads (and so installs), no check starts another: the user who asks
    /// is told where it stands, and a background check shows nothing.
    #[test]
    fn checks_while_downloading_start_nothing() {
        let _serial = serial();
        let app = mock_app(serve_update());
        let _clean = CleanUp(app.handle().clone());
        let main = window(&app, "main_0");
        let settings = window(&app, "settings");
        let rx = record(&[&main, &settings]);

        assert_eq!(user_check(&main), Ok(true));
        let first = drain(&rx);
        let reply = reply_id(prompts(&first)[0]);
        ack(&app, &reply);
        answer(&app, &reply, serde_json::json!({ "type": "action", "action": "install" }));
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(
            app.state::<UpdateGate>().state(),
            yaak_updater::UpdateState::Downloading { version: "99.0.0".into() }
        );

        assert_eq!(user_check(&settings), Ok(true));
        assert_eq!(background_check(&main), Ok(false));
        let during = drain(&rx);
        assert!(prompts(&during).is_empty(), "no new prompt: {during:?}");
        let told: Vec<_> =
            during.iter().filter(|s| s.event == yaak_updater::UPDATE_STATE_EVENT).collect();
        assert_eq!(told.len(), 1, "only the user who asked is told: {during:?}");
        assert_eq!(told[0].window, "settings");
        assert_eq!(
            told[0].payload,
            serde_json::json!({ "state": "downloading", "version": "99.0.0" })
        );

        // The download isn't a signed archive, so the install fails and the run ends
        wait_for_idle(&app);
    }
}
