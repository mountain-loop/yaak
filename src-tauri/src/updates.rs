use std::fmt::{Display, Formatter};
use std::time::SystemTime;

use crate::error::Result;
use log::info;
use tauri::{Manager, Runtime, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;
use tokio::task::block_in_place;
use yaak_models::query_manager::QueryManagerExt;
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

pub enum UpdateTrigger {
    Background,
    User,
}

impl YaakUpdater {
    pub fn new() -> Self {
        Self {
            last_update_check: SystemTime::UNIX_EPOCH,
        }
    }

    pub async fn check_now<R: Runtime>(
        &mut self,
        window: &WebviewWindow<R>,
        mode: UpdateMode,
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
        self.last_update_check = SystemTime::now();

        info!("Checking for updates mode={}", mode);

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
                w.dialog()
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
                                    if w.dialog()
                                        .message("Would you like to restart the app?")
                                        .title("Update Installed")
                                        .buttons(MessageDialogButtons::OkCancelCustom(
                                            "Restart".to_string(),
                                            "Later".to_string(),
                                        ))
                                        .blocking_show()
                                    {
                                        w.app_handle().restart();
                                    }
                                }
                                Err(e) => {
                                    w.dialog()
                                        .message(format!("The update failed to install: {}", e));
                                }
                            }
                        });
                    });
                true
            }
        };

        Ok(result)
    }
    pub async fn maybe_check<R: Runtime>(
        &mut self,
        window: &WebviewWindow<R>,
        mode: UpdateMode,
    ) -> Result<bool> {
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

        self.check_now(window, mode, UpdateTrigger::Background).await
    }
}
