use std::fmt::{Display, Formatter};
use std::time::SystemTime;

use log::info;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;
use tokio::task::block_in_place;
use yaak_plugins::manager::PluginManager;

use crate::is_dev;

const MAX_UPDATE_CHECK_HOURS_STABLE: u64 = 12;
const MAX_UPDATE_CHECK_HOURS_BETA: u64 = 3;
const MAX_UPDATE_CHECK_HOURS_ALPHA: u64 = 1;

// Create updater struct
pub struct YaakUpdater {
    last_update_check: SystemTime,
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

impl YaakUpdater {
    pub fn new() -> Self {
        Self {
            last_update_check: SystemTime::UNIX_EPOCH,
        }
    }

    pub async fn force_check(
        &mut self,
        app_handle: &AppHandle,
        mode: UpdateMode,
    ) -> Result<bool, tauri_plugin_updater::Error> {
        self.last_update_check = SystemTime::now();

        info!("Checking for updates mode={}", mode);

        let h = app_handle.clone();
        let update_check_result = app_handle
            .updater_builder()
            .on_before_exit(move || {
                // Kill plugin manager before exit or NSIS installer will fail to replace sidecar
                // while it's running.
                // NOTE: This is only called on Windows
                let h = h.clone();
                block_in_place(|| {
                    tauri::async_runtime::block_on(async move {
                        info!("Shutting down plugin manager before update");
                        let plugin_manager = h.state::<PluginManager>();
                        plugin_manager.terminate().await;
                    });
                });
            })
            .header("X-Update-Mode", mode.to_string())?
            .build()?
            .check()
            .await;

        match update_check_result {
            Ok(Some(update)) => {
                let h = app_handle.clone();
                app_handle
                    .dialog()
                    .message(format!(
                        "{} is available. Would you like to download and install it now?",
                        update.version
                    ))
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Download".to_string(),
                        "Later".to_string(),
                    ))
                    .title("Update Available")
                    .show(|confirmed| {
                        if !confirmed {
                            return;
                        }
                        tauri::async_runtime::spawn(async move {
                            match update.download_and_install(|_, _| {}, || {}).await {
                                Ok(_) => {
                                    if h.dialog()
                                        .message("Would you like to restart the app?")
                                        .title("Update Installed")
                                        .buttons(MessageDialogButtons::OkCancelCustom(
                                            "Restart".to_string(),
                                            "Later".to_string(),
                                        ))
                                        .blocking_show()
                                    {
                                        h.restart();
                                    }
                                }
                                Err(e) => {
                                    h.dialog()
                                        .message(format!("The update failed to install: {}", e));
                                }
                            }
                        });
                    });
                Ok(true)
            }
            Ok(None) => Ok(false),
            Err(e) => Err(e),
        }
    }
    pub async fn check(
        &mut self,
        app_handle: &AppHandle,
        mode: UpdateMode,
    ) -> Result<bool, tauri_plugin_updater::Error> {
        let update_period_seconds = match mode {
            UpdateMode::Stable => MAX_UPDATE_CHECK_HOURS_STABLE,
            UpdateMode::Beta => MAX_UPDATE_CHECK_HOURS_BETA,
            UpdateMode::Alpha => MAX_UPDATE_CHECK_HOURS_ALPHA,
        } * (60 * 60);
        let seconds_since_last_check = self.last_update_check.elapsed().unwrap().as_secs();
        let ignore_check = seconds_since_last_check < update_period_seconds;
        if ignore_check {
            return Ok(false);
        }

        // Don't check if dev
        if is_dev() {
            return Ok(false);
        }

        self.force_check(app_handle, mode).await
    }
}
