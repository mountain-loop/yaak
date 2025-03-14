use std::time::SystemTime;

use chrono::{DateTime, Utc};
use log::debug;
use serde::{Deserialize, Serialize};
use tauri::{Runtime, WebviewWindow};
use yaak_models::queries::{get_key_value_raw, set_key_value_raw, UpdateSource};

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

    pub async fn check<R: Runtime>(&mut self, _window: &WebviewWindow<R>) -> Result<(), String> {
        Ok(())
    }
}

async fn get_kv<R: Runtime>(w: &WebviewWindow<R>) -> Result<Vec<String>, String> {
    match get_key_value_raw(w, "notifications", "seen").await {
        None => Ok(Vec::new()),
        Some(v) => serde_json::from_str(&v.value).map_err(|e| e.to_string()),
    }
}
