use std::time::SystemTime;

use crate::error::Result;
use crate::history::get_or_upsert_launch_info;
use chrono::{DateTime, Utc};
use log::debug;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use ts_rs::TS;
use yaak_common::api_client::yaak_api_client;
use yaak_common::platform::get_os;
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::UpdateSource;

// Check for updates every hour
const MAX_UPDATE_CHECK_SECONDS: u64 = 60 * 60;

const KV_NAMESPACE: &str = "notifications";
const KV_KEY: &str = "seen";

// Create updater struct
pub struct YaakNotifier {
    last_check: SystemTime,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "index.ts")]
pub struct YaakNotification {
    timestamp: DateTime<Utc>,
    timeout: Option<f64>,
    id: String,
    title: Option<String>,
    message: String,
    color: Option<String>,
    action: Option<YaakNotificationAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "index.ts")]
pub struct YaakNotificationAction {
    label: String,
    url: String,
}

impl YaakNotifier {
    pub fn new() -> Self {
        Self {
            last_check: SystemTime::UNIX_EPOCH,
        }
    }

    pub async fn seen<R: Runtime>(&mut self, window: &WebviewWindow<R>, id: &str) -> Result<()> {
        let app_handle = window.app_handle();
        let mut seen = get_kv(app_handle).await?;
        seen.push(id.to_string());
        debug!("Marked notification as seen {}", id);
        let seen_json = serde_json::to_string(&seen)?;
        window.db().set_key_value_raw(
            KV_NAMESPACE,
            KV_KEY,
            seen_json.as_str(),
            &UpdateSource::from_window(window),
        );
        Ok(())
    }

    pub async fn maybe_check<R: Runtime>(&mut self, window: &WebviewWindow<R>) -> Result<()> {
        let app_handle = window.app_handle();
        let ignore_check = self.last_check.elapsed().unwrap().as_secs() < MAX_UPDATE_CHECK_SECONDS;

        if ignore_check {
            return Ok(());
        }

        self.last_check = SystemTime::now();

        #[cfg(feature = "license")]
        let license_check = {
            use yaak_license::{check_license, LicenseCheckStatus};
            match check_license(window).await {
                Ok(LicenseCheckStatus::PersonalUse { .. }) => "personal".to_string(),
                Ok(LicenseCheckStatus::CommercialUse) => "commercial".to_string(),
                Ok(LicenseCheckStatus::InvalidLicense) => "invalid_license".to_string(),
                Ok(LicenseCheckStatus::Trialing { .. }) => "trialing".to_string(),
                Err(_) => "unknown".to_string(),
            }
        };
        #[cfg(not(feature = "license"))]
        let license_check = "disabled".to_string();

        let launch_info = get_or_upsert_launch_info(app_handle);
        let req = yaak_api_client(app_handle)?
            .request(Method::GET, "https://notify.yaak.app/notifications")
            .query(&[
                ("version", &launch_info.current_version),
                ("version_prev", &launch_info.previous_version),
                ("launches", &launch_info.num_launches.to_string()),
                ("installed", &launch_info.user_since.format("%Y-%m-%d").to_string()),
                ("license", &license_check),
                ("updates", &get_updater_status(app_handle).to_string()),
                ("platform", &get_os().to_string()),
            ]);
        let resp = req.send().await?;
        if resp.status() != 200 {
            debug!("Skipping notification status code {}", resp.status());
            return Ok(());
        }

        for notification in resp.json::<Vec<YaakNotification>>().await? {
            let seen = get_kv(app_handle).await?;
            if seen.contains(&notification.id) {
                debug!("Already seen notification {}", notification.id);
                continue;
            }
            debug!("Got notification {:?}", notification);

            let _ = app_handle.emit_to(window.label(), "notification", notification.clone());
            break; // Only show one notification
        }

        Ok(())
    }
}

async fn get_kv<R: Runtime>(app_handle: &AppHandle<R>) -> Result<Vec<String>> {
    match app_handle.db().get_key_value_raw("notifications", "seen") {
        None => Ok(Vec::new()),
        Some(v) => Ok(serde_json::from_str(&v.value)?),
    }
}

fn get_updater_status<R: Runtime>(app_handle: &AppHandle<R>) -> &'static str {
    #[cfg(not(feature = "updater"))]
    {
        // Updater is not enabled as a Rust feature
        return "missing";
    }

    #[cfg(all(feature = "updater", target_os = "linux"))]
    {
        let settings = app_handle.db().get_settings();
        if !settings.autoupdate {
            // Updates are explicitly disabled
            "disabled"
        } else if std::env::var("APPIMAGE").is_err() {
            // Updates are enabled, but unsupported
            "unsupported"
        } else {
            // Updates are enabled and supported
            "enabled"
        }
    }

    #[cfg(all(feature = "updater", not(target_os = "linux")))]
    {
        let settings = app_handle.db().get_settings();
        if settings.autoupdate { "enabled" } else { "disabled" }
    }
}
