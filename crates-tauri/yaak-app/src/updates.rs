use std::fmt::{Display, Formatter};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::error::Result;
use crate::models_ext::QueryManagerExt;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Listener, Manager, Runtime, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::task::block_in_place;
use tokio::time::sleep;
use ts_rs::TS;
use yaak_models::util::generate_id;
use yaak_plugins::manager::PluginManager;

use crate::error::Error::GenericError;
use crate::is_dev;

const MAX_UPDATE_CHECK_HOURS_STABLE: u64 = 12;
const MAX_UPDATE_CHECK_HOURS_BETA: u64 = 3;
const MAX_UPDATE_CHECK_HOURS_ALPHA: u64 = 1;

// Create updater struct
pub struct YaakUpdater {
    last_check: Option<Instant>,
}

pub enum UpdateMode {
    Stable,
    Beta,
    Alpha,
}

impl Display for UpdateMode {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            UpdateMode::Stable => "stable",
            UpdateMode::Beta => "beta",
            UpdateMode::Alpha => "alpha",
        };
        write!(f, "{}", s)
    }
}

impl UpdateMode {
    pub fn new(mode: &str) -> UpdateMode {
        match mode {
            "beta" => UpdateMode::Beta,
            "alpha" => UpdateMode::Alpha,
            _ => UpdateMode::Stable,
        }
    }
}

#[derive(PartialEq)]
pub enum UpdateTrigger {
    Background,
    User,
}

impl YaakUpdater {
    pub fn new() -> Self {
        Self { last_check: None }
    }

    pub async fn check_now<R: Runtime>(
        &mut self,
        window: &WebviewWindow<R>,
        mode: UpdateMode,
        auto_download: bool,
        update_trigger: UpdateTrigger,
    ) -> Result<bool> {
        // Only AppImage supports updates on Linux, so skip if it's not
        #[cfg(target_os = "linux")]
        {
            if std::env::var("APPIMAGE").is_err() {
                return Ok(false);
            }
        }

        let settings = window.db().get_settings();
        let update_key = format!("{:x}", md5::compute(settings.id));
        self.last_check = Some(Instant::now());

        info!("Checking for updates mode={} autodl={}", mode, auto_download);

        let w = window.clone();
        let update_check_result = w
            .updater_builder()
            .on_before_exit(move || {
                // Kill plugin manager before exit or NSIS installer will fail to replace sidecar
                // while it's running.
                // NOTE: This is only called on Windows
                let w = w.clone();
                block_in_place(|| {
                    tauri::async_runtime::block_on(async move {
                        info!("Shutting down plugin manager before update");
                        let plugin_manager = w.state::<PluginManager>();
                        plugin_manager.terminate().await;
                    });
                });
            })
            .header("X-Update-Mode", mode.to_string())?
            .header("X-Update-Key", update_key)?
            .header(
                "X-Update-Trigger",
                match update_trigger {
                    UpdateTrigger::Background => "background",
                    UpdateTrigger::User => "user",
                },
            )?
            .build()?
            .check()
            .await;

        let result = match update_check_result? {
            None => false,
            Some(update) => {
                let w = window.clone();
                tauri::async_runtime::spawn(async move {
                    // Force native updater if specified (useful if a release broke the UI)
                    let native_install_mode =
                        update.raw_json.get("install_mode").map(|v| v.as_str()).unwrap_or_default()
                            == Some("native");
                    if native_install_mode {
                        start_native_update(&w, &update).await;
                        return;
                    }

                    // If it's a background update, try downloading it first
                    if update_trigger == UpdateTrigger::Background && auto_download {
                        info!("Downloading update {} in background", update.version);
                        if let Err(e) = download_update_idempotent(&w, &update).await {
                            error!("Failed to download {}: {}", update.version, e);
                        }
                    }

                    match start_integrated_update(&w, &update).await {
                        Ok(UpdateResponseAction::Skip) => {
                            info!("Confirmed {}: skipped", update.version);
                        }
                        Ok(UpdateResponseAction::Install) => {
                            info!("Confirmed {}: install", update.version);
                            if let Err(e) = install_update_maybe_download(&w, &update).await {
                                error!("Failed to install: {e}");
                                return;
                            };

                            info!("Installed {}", update.version);
                            finish_integrated_update(&w, &update).await;
                        }
                        Err(e) => {
                            warn!("Failed to notify frontend, falling back: {e}",);
                            start_native_update(&w, &update).await;
                        }
                    };
                });
                true
            }
        };

        Ok(result)
    }
    pub async fn maybe_check<R: Runtime>(
        &mut self,
        window: &WebviewWindow<R>,
        auto_download: bool,
        mode: UpdateMode,
    ) -> Result<bool> {
        let update_period_seconds = match mode {
            UpdateMode::Stable => MAX_UPDATE_CHECK_HOURS_STABLE,
            UpdateMode::Beta => MAX_UPDATE_CHECK_HOURS_BETA,
            UpdateMode::Alpha => MAX_UPDATE_CHECK_HOURS_ALPHA,
        } * (60 * 60);

        if let Some(i) = self.last_check
            && i.elapsed().as_secs() < update_period_seconds
        {
            return Ok(false);
        }

        // Don't check if development (can still with manual user trigger)
        if is_dev() {
            return Ok(false);
        }

        self.check_now(window, mode, auto_download, UpdateTrigger::Background).await
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "index.ts")]
struct UpdateInfo {
    reply_event_id: String,
    version: String,
    downloaded: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "index.ts")]
enum UpdateResponse {
    Ack,
    Action { action: UpdateResponseAction },
}

#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
enum UpdateResponseAction {
    Install,
    Skip,
}

async fn finish_integrated_update<R: Runtime>(window: &WebviewWindow<R>, update: &Update) {
    if let Err(e) = window.emit_to(window.label(), "update_installed", update.version.to_string()) {
        warn!("Failed to notify frontend of update install: {}", e);
    }
}

async fn start_integrated_update<R: Runtime>(
    window: &WebviewWindow<R>,
    update: &Update,
) -> Result<UpdateResponseAction> {
    let download_path = ensure_download_path(window, update)?;
    debug!("Download path: {}", download_path.display());
    let downloaded = download_path.exists();
    let ack_wait = Duration::from_secs(3);
    let reply_id = generate_id();

    // 1) Start listening BEFORE emitting to avoid missing a fast reply
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<UpdateResponse>();
    let w_for_listener = window.clone();

    let event_id = w_for_listener.listen(reply_id.clone(), move |ev| {
        match serde_json::from_str::<UpdateResponse>(ev.payload()) {
            Ok(UpdateResponse::Ack) => {
                let _ = tx.send(UpdateResponse::Ack);
            }
            Ok(UpdateResponse::Action { action }) => {
                let _ = tx.send(UpdateResponse::Action { action });
            }
            Err(e) => {
                warn!("Failed to parse update reply from frontend: {e:?}");
            }
        }
    });

    // Make sure we always unlisten
    struct Unlisten<'a, R: Runtime> {
        win: &'a WebviewWindow<R>,
        id: tauri::EventId,
    }
    impl<'a, R: Runtime> Drop for Unlisten<'a, R> {
        fn drop(&mut self) {
            self.win.unlisten(self.id);
        }
    }
    let _guard = Unlisten { win: window, id: event_id };

    // 2) Emit the event now that listener is in place
    let info =
        UpdateInfo { version: update.version.to_string(), downloaded, reply_event_id: reply_id };
    window
        .emit_to(window.label(), "update_available", &info)
        .map_err(|e| GenericError(format!("Failed to emit update_available: {e}")))?;

    // 3) Two-stage timeout: first wait for ack, then wait for final action
    // --- Phase 1: wait for ACK with timeout ---
    let ack_timer = sleep(ack_wait);
    tokio::pin!(ack_timer);

    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Some(UpdateResponse::Ack) => break, // proceed to Phase 2
                Some(UpdateResponse::Action{action}) => return Ok(action), // user was fast
                None => return Err(GenericError("frontend channel closed before ack".into())),
            },
            _ = &mut ack_timer => {
                return Err(GenericError("timed out waiting for frontend ack".into()));
            }
        }
    }

    // --- Phase 2: wait forever for final action ---
    loop {
        match rx.recv().await {
            Some(UpdateResponse::Action { action }) => return Ok(action),
            Some(UpdateResponse::Ack) => { /* ignore extra acks */ }
            None => return Err(GenericError("frontend channel closed before action".into())),
        }
    }
}

async fn start_native_update<R: Runtime>(window: &WebviewWindow<R>, update: &Update) {
    // If the frontend doesn't respond, fallback to native dialogs
    let confirmed = window
        .dialog()
        .message(format!(
            "{} is available. Would you like to download and install it now?",
            update.version
        ))
        .buttons(MessageDialogButtons::OkCancelCustom("Download".to_string(), "Later".to_string()))
        .title("Update Available")
        .blocking_show();
    if !confirmed {
        return;
    }

    match update.download_and_install(|_, _| {}, || {}).await {
        Ok(()) => {
            if window
                .dialog()
                .message("Would you like to restart the app?")
                .title("Update Installed")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Restart".to_string(),
                    "Later".to_string(),
                ))
                .blocking_show()
            {
                window.app_handle().request_restart();
            }
        }
        Err(e) => {
            window.dialog().message(format!("The update failed to install: {}", e));
        }
    }
}

pub async fn download_update_idempotent<R: Runtime>(
    window: &WebviewWindow<R>,
    update: &Update,
) -> Result<PathBuf> {
    let dl_path = ensure_download_path(window, update)?;

    if dl_path.exists() {
        info!("{} already downloaded to {}", update.version, dl_path.display());
        return Ok(dl_path);
    }

    info!("{} downloading: {}", update.version, dl_path.display());
    let dl_bytes = update.download(|_, _| {}, || {}).await?;
    std::fs::write(&dl_path, dl_bytes)
        .map_err(|e| GenericError(format!("Failed to write update: {e}")))?;

    info!("{} downloaded", update.version);

    Ok(dl_path)
}

pub async fn install_update_maybe_download<R: Runtime>(
    window: &WebviewWindow<R>,
    update: &Update,
) -> Result<()> {
    let dl_path = download_update_idempotent(window, update).await?;
    let update_bytes = std::fs::read(&dl_path)?;
    update.install(update_bytes.as_slice())?;
    Ok(())
}

pub fn ensure_download_path<R: Runtime>(
    window: &WebviewWindow<R>,
    update: &Update,
) -> Result<PathBuf> {
    // Ensure dir exists
    let base_dir = window.path().app_cache_dir()?.join("updates");
    std::fs::create_dir_all(&base_dir)?;

    // Generate name based on signature
    let sig_digest = md5::compute(&update.signature);
    let name = format!("yaak-{}-{:x}", update.version, sig_digest);
    let dl_path = base_dir.join(name);

    Ok(dl_path)
}
