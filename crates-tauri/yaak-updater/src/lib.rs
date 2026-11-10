//! The update flow Yaak and Yaak Proxy share. Each app asks its own update endpoint, with its
//! own headers, and hands an [`Update`] it finds to [`prompt_and_install`], which asks the
//! window (or a native dialog, when the window doesn't answer), downloads, installs and tells
//! the window it can relaunch through [`restart`].

use std::fmt::{Display, Formatter};
use std::path::PathBuf;
use std::time::Duration;

use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Listener, Manager, Runtime, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::Update;
use tokio::time::sleep;
use ts_rs::TS;

pub mod restart;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Updater error: {0}")]
    UpdaterError(#[from] tauri_plugin_updater::Error),

    #[error("Tauri error: {0}")]
    TauriError(#[from] tauri::Error),

    #[error("I/O error: {0}")]
    IOError(#[from] std::io::Error),

    #[error("{0}")]
    GenericError(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// The event the window hears of an available update by, with an [`UpdateInfo`].
pub const UPDATE_AVAILABLE_EVENT: &str = "update_available";

/// The event the window hears of an installed update by, with its version.
pub const UPDATE_INSTALLED_EVENT: &str = "update_installed";

const MAX_UPDATE_CHECK_HOURS_STABLE: u64 = 12;
const MAX_UPDATE_CHECK_HOURS_BETA: u64 = 3;
const MAX_UPDATE_CHECK_HOURS_ALPHA: u64 = 1;

/// The release channel an app follows, sent to the update server as `X-Update-Mode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

    /// How long a background check waits after the last one on this channel.
    pub fn check_interval(&self) -> Duration {
        let hours = match self {
            UpdateMode::Stable => MAX_UPDATE_CHECK_HOURS_STABLE,
            UpdateMode::Beta => MAX_UPDATE_CHECK_HOURS_BETA,
            UpdateMode::Alpha => MAX_UPDATE_CHECK_HOURS_ALPHA,
        };
        Duration::from_secs(hours * 60 * 60)
    }
}

/// Who asked for a check, sent to the update server as `X-Update-Trigger`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateTrigger {
    Background,
    User,
}

impl UpdateTrigger {
    pub fn header_value(&self) -> &'static str {
        match self {
            UpdateTrigger::Background => "background",
            UpdateTrigger::User => "user",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "index.ts")]
pub struct UpdateInfo {
    pub reply_event_id: String,
    pub version: String,
    pub downloaded: bool,
    /// How this update gets applied. Anything but `Integrated` means the app can't do it
    /// itself and the user is told how to update instead.
    pub install: UpdateInstall,
}

/// How an update can be applied to this install.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Default, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum UpdateInstall {
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
pub enum UpdateResponse {
    Ack,
    Action { action: UpdateResponseAction },
}

#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum UpdateResponseAction {
    Install,
    Skip,
}

/// Offers `update` in `window` and, if the user takes it, downloads and installs it. Returns
/// once that is settled; spawn it so the check that found the update can answer first.
///
/// `install` says whether this install can apply the update itself; when it can't, the window
/// is only told how to update. A background check downloads first when `auto_download` is set,
/// so the prompt can offer to install at once.
pub async fn prompt_and_install<R: Runtime>(
    window: &WebviewWindow<R>,
    update: &Update,
    trigger: UpdateTrigger,
    auto_download: bool,
    install: UpdateInstall,
) {
    // Only hand the artifact to the updater plugin when this install can apply it itself;
    // otherwise tell the user how to update instead
    if install != UpdateInstall::Integrated {
        info!("{} available, but this install updates via {install:?}", update.version);
        notify_external_update(window, update, install);
        return;
    }

    // Force native updater if specified (useful if a release broke the UI)
    let native_install_mode =
        update.raw_json.get("install_mode").map(|v| v.as_str()).unwrap_or_default()
            == Some("native");
    if native_install_mode {
        start_native_update(window, update).await;
        return;
    }

    // If it's a background update, try downloading it first
    if trigger == UpdateTrigger::Background && auto_download {
        info!("Downloading update {} in background", update.version);
        if let Err(e) = download_update_idempotent(window, update).await {
            error!("Failed to download {}: {}", update.version, e);
        }
    }

    match start_integrated_update(window, update).await {
        Ok(UpdateResponseAction::Skip) => {
            info!("Confirmed {}: skipped", update.version);
        }
        Ok(UpdateResponseAction::Install) => {
            info!("Confirmed {}: install", update.version);
            if let Err(e) = install_update_maybe_download(window, update).await {
                error!("Failed to install: {e}");
                return;
            };

            info!("Installed {}", update.version);
            finish_integrated_update(window, update).await;
        }
        Err(e) => {
            warn!("Failed to notify frontend, falling back: {e}",);
            start_native_update(window, update).await;
        }
    };
}

async fn finish_integrated_update<R: Runtime>(window: &WebviewWindow<R>, update: &Update) {
    if let Err(e) =
        window.emit_to(window.label(), UPDATE_INSTALLED_EVENT, update.version.to_string())
    {
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
    let reply_id = generate_reply_id();

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
        .emit_to(window.label(), UPDATE_AVAILABLE_EVENT, &info)
        .map_err(|e| Error::GenericError(format!("Failed to emit update_available: {e}")))?;

    // 3) Two-stage timeout: first wait for ack, then wait for final action
    // --- Phase 1: wait for ACK with timeout ---
    tokio::select! {
        msg = rx.recv() => match msg {
            Some(UpdateResponse::Ack) => {} // proceed to Phase 2
            Some(UpdateResponse::Action{action}) => return Ok(action), // user was fast
            None => return Err(Error::GenericError("frontend channel closed before ack".into())),
        },
        _ = sleep(ack_wait) => {
            return Err(Error::GenericError("timed out waiting for frontend ack".into()));
        }
    }

    // --- Phase 2: wait forever for final action ---
    loop {
        match rx.recv().await {
            Some(UpdateResponse::Action { action }) => return Ok(action),
            Some(UpdateResponse::Ack) => { /* ignore extra acks */ }
            None => {
                return Err(Error::GenericError("frontend channel closed before action".into()));
            }
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
        reply_event_id: generate_reply_id(),
    };
    if let Err(e) = window.emit_to(window.label(), UPDATE_AVAILABLE_EVENT, &info) {
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
        .map_err(|e| Error::GenericError(format!("Failed to write update: {e}")))?;

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

/// A fresh event name for the window's replies to one prompt, as Yaak's model ids are made.
fn generate_reply_id() -> String {
    let alphabet: [char; 57] = [
        '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
        'k', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C',
        'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W',
        'X', 'Y', 'Z',
    ];
    nanoid::nanoid!(10, &alphabet)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_read_as_their_channel_names() {
        assert_eq!(UpdateMode::new("beta"), UpdateMode::Beta);
        assert_eq!(UpdateMode::new("alpha"), UpdateMode::Alpha);
        assert_eq!(UpdateMode::new("stable"), UpdateMode::Stable);
        // Anything unknown is stable
        assert_eq!(UpdateMode::new(""), UpdateMode::Stable);
        assert_eq!(UpdateMode::Beta.to_string(), "beta");
    }

    #[test]
    fn beta_checks_more_often_than_stable() {
        assert_eq!(UpdateMode::Stable.check_interval(), Duration::from_secs(12 * 60 * 60));
        assert_eq!(UpdateMode::Beta.check_interval(), Duration::from_secs(3 * 60 * 60));
        assert_eq!(UpdateMode::Alpha.check_interval(), Duration::from_secs(60 * 60));
    }
}
