use std::time::SystemTime;

use crate::error::Result;
use crate::history::get_num_launches;
use chrono::{DateTime, Duration, Utc};
use log::debug;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use yaak_common::platform::get_os;
use yaak_license::{LicenseCheckStatus, check_license};
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct YaakNotification {
    timestamp: DateTime<Utc>,
    id: String,
    message: String,
    action: Option<YaakNotificationAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
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

    pub async fn check<R: Runtime>(&mut self, window: &WebviewWindow<R>) -> Result<()> {
        let app_handle = window.app_handle();
        let ignore_check = self.last_check.elapsed().unwrap().as_secs() < MAX_UPDATE_CHECK_SECONDS;

        if ignore_check {
            return Ok(());
        }

        self.last_check = SystemTime::now();

        let license_check = match check_license(window).await? {
            LicenseCheckStatus::PersonalUse { .. } => "personal".to_string(),
            LicenseCheckStatus::CommercialUse => "commercial".to_string(),
            LicenseCheckStatus::InvalidLicense => "invalid_license".to_string(),
            LicenseCheckStatus::Trialing { .. } => "trialing".to_string(),
        };
        let settings = window.db().get_settings();
        let num_launches = get_num_launches(app_handle).await;
        let info = app_handle.package_info().clone();
        let req = reqwest::Client::default()
            .request(Method::GET, "https://notify.yaak.app/notifications")
            .query(&[
                ("version", info.version.to_string().as_str()),
                ("launches", num_launches.to_string().as_str()),
                ("installed", settings.created_at.format("%Y-%m-%d").to_string().as_str()),
                ("license", &license_check),
                ("platform", get_os()),
            ]);
        let resp = req.send().await?;
        if resp.status() != 200 {
            debug!("Skipping notification status code {}", resp.status());
            return Ok(());
        }

        let result = resp.json::<Value>().await?;

        // Support both single and multiple notifications.
        // TODO: Remove support for single after April 2025
        let notifications = match result {
            Value::Array(a) => a
                .into_iter()
                .map(|a| serde_json::from_value(a).unwrap())
                .collect::<Vec<YaakNotification>>(),
            a @ _ => vec![serde_json::from_value(a).unwrap()],
        };

        for notification in notifications {
            let age = notification.timestamp.signed_duration_since(Utc::now());
            let seen = get_kv(app_handle).await?;
            if seen.contains(&notification.id) || (age > Duration::days(2)) {
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
