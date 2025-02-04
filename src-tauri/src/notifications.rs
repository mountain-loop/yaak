use std::time::SystemTime;

use crate::analytics::{get_num_launches, get_os};
use chrono::{DateTime, Duration, Utc};
use log::debug;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Manager, Runtime, WebviewWindow};
use yaak_models::queries::{get_key_value_raw, set_key_value_raw, UpdateSource};

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

    pub async fn seen<R: Runtime>(&mut self, w: &WebviewWindow<R>, id: &str) -> Result<(), String> {
        let mut seen = get_kv(w).await?;
        seen.push(id.to_string());
        debug!("Marked notification as seen {}", id);
        let seen_json = serde_json::to_string(&seen).map_err(|e| e.to_string())?;
        set_key_value_raw(w, KV_NAMESPACE, KV_KEY, seen_json.as_str(), &UpdateSource::Window).await;
        Ok(())
    }

    pub async fn check<R: Runtime>(&mut self, window: &WebviewWindow<R>) -> Result<(), String> {
        let ignore_check = self.last_check.elapsed().unwrap().as_secs() < MAX_UPDATE_CHECK_SECONDS;

        if ignore_check {
            return Ok(());
        }

        self.last_check = SystemTime::now();

        let num_launches = get_num_launches(window).await;
        let info = window.app_handle().package_info().clone();
        let req = reqwest::Client::default()
            .request(Method::GET, "https://notify.yaak.app/notifications")
            .query(&[
                ("version", info.version.to_string().as_str()),
                ("launches", num_launches.to_string().as_str()),
                ("platform", get_os())
            ]);
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if resp.status() != 200 {
            debug!("Skipping notification status code {}", resp.status());
            return Ok(());
        }

        let result = resp.json::<Value>().await.map_err(|e| e.to_string())?;

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
            let seen = get_kv(window).await?;
            if seen.contains(&notification.id) || (age > Duration::days(2)) {
                debug!("Already seen notification {}", notification.id);
                return Ok(());
            }
            debug!("Got notification {:?}", notification);

            let _ = window.emit_to(window.label(), "notification", notification.clone());
        }

        Ok(())
    }
}

async fn get_kv<R: Runtime>(w: &WebviewWindow<R>) -> Result<Vec<String>, String> {
    match get_key_value_raw(w, "notifications", "seen").await {
        None => Ok(Vec::new()),
        Some(v) => serde_json::from_str(&v.value).map_err(|e| e.to_string()),
    }
}
