use std::fmt::{Display, Formatter};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::error::Result;
use crate::models_ext::QueryManagerExt;
use crate::restart;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Listener, Manager, Runtime, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::task::block_in_place;
use tokio::time::sleep;
use ts_rs::TS;
use yaak_models::util::generate_id;

use url::Url;
use yaak_api::get_system_proxy_url;

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
        let settings = window.db().get_settings();
        let update_key = format!("{:x}", md5::compute(settings.id));
        self.last_check = Some(Instant::now());

        info!("Checking for updates mode={} autodl={}", mode, auto_download);

        let w = window.clone();
        let mut updater_builder = w.updater_builder();
        if let Some(proxy_url) = get_system_proxy_url() {
            if let Ok(url) = Url::parse(&proxy_url) {
                updater_builder = updater_builder.proxy(url);
            }
        }
        let update_check_result = updater_builder
            .on_before_exit(move || {
                // Kill plugin manager before exit or NSIS installer will fail to replace sidecar
                // while it's running.
                // NOTE: This is only called on Windows
                let w = w.clone();
                block_in_place(|| {
                    tauri::async_runtime::block_on(async move {
                        info!("Shutting down plugin manager before update");
                        if let Ok(plugin_manager) = crate::plugins_ext::plugin_manager(&w).await {
                            plugin_manager.terminate().await;
                        }
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
            .header("X-Install-Mode", detect_install_mode().unwrap_or("unknown"))?
            .build()?
            .check()
            .await;

        let result = match update_check_result? {
            None => false,
            Some(update) => {
                let w = window.clone();
                tauri::async_runtime::spawn(async move {
                    // Only hand the artifact to the updater plugin when this install can
                    // apply it itself; otherwise tell the user how to update instead
                    let install = update_install_method(&update);
                    if install != UpdateInstall::Integrated {
                        info!(
                            "{} available, but this install updates via {install:?}",
                            update.version
                        );
                        notify_external_update(&w, &update, install);
                        return;
                    }

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
    /// How this update gets applied. Anything but `Integrated` means the app can't do it
    /// itself and the user is told how to update instead.
    install: UpdateInstall,
}

/// How an update can be applied to this install.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Default, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
enum UpdateInstall {
    /// The app downloads and installs it itself
    #[default]
    Integrated,
    /// Flatpak install: updated by `flatpak update` from its remote (e.g. FlatPark)
    Flatpak,
    /// Nothing can install it in-app (distro package, Nix, unknown); download by hand
    Manual,
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
    let download_path = ensure_download_dir(window)?.join(download_file_name(update));
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
    let info = UpdateInfo {
        version: update.version.to_string(),
        downloaded,
        install: UpdateInstall::Integrated,
        reply_event_id: reply_id,
    };
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

/// Tell the frontend about an update this install can't apply itself, so the user can be
/// told how to get it. Unlike the integrated flow, there is nothing to reply to.
fn notify_external_update<R: Runtime>(
    window: &WebviewWindow<R>,
    update: &Update,
    install: UpdateInstall,
) {
    let info = UpdateInfo {
        version: update.version.to_string(),
        downloaded: false,
        install,
        reply_event_id: generate_id(),
    };
    if let Err(e) = window.emit_to(window.label(), "update_available", &info) {
        warn!("Failed to emit update_available: {e}");
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
                restart::request_restart(window.app_handle());
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
    let dl_path = ensure_download_dir(window)?.join(download_file_name(update));

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

/// Detect the installer type so the update server can serve the correct artifact.
fn detect_install_mode() -> Option<&'static str> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe) = std::env::current_exe() {
            let path = exe.to_string_lossy().to_lowercase();
            if path.starts_with(r"c:\program files") {
                return Some("nsis-machine");
            }
        }
        return Some("nsis");
    }
    #[allow(unreachable_code)]
    if !cfg!(target_os = "linux") {
        None
    } else if is_flatpak() {
        Some("flatpak")
    } else {
        linux_installer()
    }
}

/// Flatpak installs (e.g. FlatPark) are updated by flatpak from their remote; the in-app
/// updater can't write inside the sandbox and must not try.
fn is_flatpak() -> bool {
    std::env::var_os("FLATPAK_ID").is_some()
}

/// How Yaak was installed on Linux, as far as the updater plugin can install into it.
///
/// The bundle type is stamped into the binary by the bundler, but that only says how the
/// binary was *packaged*: third-party packages (AUR, Nix, ...) repackage the .deb, and
/// letting dpkg/rpm replace those would stomp on another package manager's files. So a
/// deb/rpm install also has to be one the package manager actually owns. The AppImage
/// updater needs `$APPIMAGE` since that's the file it replaces.
fn linux_installer() -> Option<&'static str> {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    match bundle_type() {
        Some(BundleType::Deb) if package_manager_owns_exe("dpkg", "-S") => Some("deb"),
        Some(BundleType::Rpm) if package_manager_owns_exe("rpm", "-qf") => Some("rpm"),
        Some(BundleType::Deb) | Some(BundleType::Rpm) => None,
        _ if std::env::var_os("APPIMAGE").is_some() => Some("appimage"),
        _ => None,
    }
}

/// Whether `cmd query_arg <current exe>` succeeds, i.e. that package manager knows the
/// running executable as one of its files. False when the tool isn't installed at all.
fn package_manager_owns_exe(cmd: &str, query_arg: &str) -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    std::process::Command::new(cmd)
        .arg(query_arg)
        .arg(&exe)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// How the artifact the server returned can be applied to this install. On Linux the
/// server may hand back a different package format than the one installed, Flatpak can't
/// be written from inside the sandbox, and unknown install methods (distro packages,
/// Nix, ...) can't be updated in-app at all.
fn update_install_method(update: &Update) -> UpdateInstall {
    // Dev-only override to preview the non-integrated flows on any OS:
    //   YAAK_SIMULATE_INSTALL=flatpak|manual
    if is_dev() {
        match std::env::var("YAAK_SIMULATE_INSTALL").as_deref() {
            Ok("flatpak") => return UpdateInstall::Flatpak,
            Ok("manual") => return UpdateInstall::Manual,
            _ => {}
        }
    }

    if !cfg!(target_os = "linux") {
        return UpdateInstall::Integrated;
    }
    if is_flatpak() {
        return UpdateInstall::Flatpak;
    }
    if artifact_matches_installer(linux_installer(), update.download_url.path()) {
        UpdateInstall::Integrated
    } else {
        UpdateInstall::Manual
    }
}

/// Whether the artifact at `url_path` is in the package format `installer` can install.
fn artifact_matches_installer(installer: Option<&str>, url_path: &str) -> bool {
    let path = url_path.to_ascii_lowercase();
    match installer {
        Some("deb") => path.ends_with(".deb"),
        Some("rpm") => path.ends_with(".rpm"),
        Some("appimage") => path.ends_with(".appimage") || path.ends_with(".appimage.tar.gz"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::artifact_matches_installer;

    const BASE: &str = "/mountain-loop/yaak/releases/download/v2026.6.0/";

    #[test]
    fn matching_package_format_is_installable() {
        let cases = [
            ("deb", "yaak_2026.6.0_amd64.deb"),
            ("deb", "yaak_2026.6.0_arm64.deb"),
            ("rpm", "yaak-2026.6.0-1.x86_64.rpm"),
            ("rpm", "yaak-2026.6.0-1.aarch64.rpm"),
            ("appimage", "yaak_2026.6.0_amd64.AppImage"),
            ("appimage", "yaak_2026.6.0_amd64.AppImage.tar.gz"),
        ];
        for (installer, asset) in cases {
            assert!(
                artifact_matches_installer(Some(installer), &format!("{BASE}{asset}")),
                "{installer} should install {asset}"
            );
        }
    }

    #[test]
    fn mismatched_package_format_is_not_installable() {
        // What the server returns for every Linux install today
        let appimage = format!("{BASE}yaak_2026.6.0_amd64.AppImage");
        assert!(!artifact_matches_installer(Some("deb"), &appimage));
        assert!(!artifact_matches_installer(Some("rpm"), &appimage));

        let deb = format!("{BASE}yaak_2026.6.0_amd64.deb");
        assert!(!artifact_matches_installer(Some("rpm"), &deb));
        assert!(!artifact_matches_installer(Some("appimage"), &deb));
    }

    #[test]
    fn unknown_installer_is_never_installable() {
        for asset in ["yaak_2026.6.0_amd64.deb", "yaak_2026.6.0_amd64.AppImage"] {
            assert!(!artifact_matches_installer(None, &format!("{BASE}{asset}")));
        }
    }
}

pub async fn install_update_maybe_download<R: Runtime>(
    window: &WebviewWindow<R>,
    update: &Update,
) -> Result<()> {
    let dl_path = download_update_idempotent(window, update).await?;
    let update_bytes = std::fs::read(&dl_path)?;
    update.install(update_bytes.as_slice())?;
    delete_download_dir(window);
    Ok(())
}

pub fn download_dir<R: Runtime>(window: &WebviewWindow<R>) -> Result<PathBuf> {
    Ok(window.path().app_cache_dir()?.join("updates"))
}

pub fn ensure_download_dir<R: Runtime>(window: &WebviewWindow<R>) -> Result<PathBuf> {
    let base_dir = download_dir(window)?;
    std::fs::create_dir_all(&base_dir)?;
    Ok(base_dir)
}

pub fn download_file_name(update: &Update) -> String {
    let sig_digest = md5::compute(&update.signature);
    format!("yaak-{}-{:x}", update.version, sig_digest)
}

pub fn delete_download_dir<R: Runtime>(window: &WebviewWindow<R>) {
    let base_dir = match download_dir(window) {
        Ok(dir) => dir,
        Err(e) => {
            warn!("Failed to locate update downloads dir: {}", e);
            return;
        }
    };
    match std::fs::remove_dir_all(&base_dir) {
        Ok(()) => info!("Removed update downloads dir {}", base_dir.display()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => warn!("Failed to remove update downloads dir {}: {}", base_dir.display(), e),
    }
}
