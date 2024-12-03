use crate::errors::Result;
use chrono::{NaiveDateTime, Utc};
use log::{debug, info};
use serde::{Deserialize, Serialize};
use std::ops::Add;
use std::time::Duration;
use tauri::{is_dev, AppHandle, Runtime, WebviewWindow};
use ts_rs::TS;

const KV_NAMESPACE: &str = "license";
const KV_ACTIVATION_ID_KEY: &str = "activation_id";
const TRIAL_SECONDS: u64 = 3600 * 24 * 14;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "models.ts")]
pub struct CheckActivationRequestPayload {
    pub activation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "license.ts")]
pub struct CheckActivationResponsePayload {
    pub status: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "license.ts")]
pub struct ActivateLicenseRequestPayload {
    pub license_key: String,
    pub app_version: String,
    pub app_platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "license.ts")]
pub struct ActivateLicenseResponsePayload {
    pub activation_id: String,
}

pub async fn activate_license<R: Runtime>(
    window: &WebviewWindow<R>,
    p: ActivateLicenseRequestPayload,
) -> Result<()> {
    let client = reqwest::Client::new();
    let response = client.post(build_url("/activate")).json(&p).send().await?;

    debug!("Activated license status={}", response.status());
    let body_text = response.text().await?;
    debug!("Activated license: {}", body_text);

    let body: ActivateLicenseResponsePayload = serde_json::from_str(&body_text)?;
    yaak_models::queries::set_key_value_string(
        window,
        KV_ACTIVATION_ID_KEY,
        KV_NAMESPACE,
        body.activation_id.as_str(),
    )
    .await;
    Ok(())
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "license.ts")]
pub enum LicenseCheckStatus {
    PersonalUse,
    CommercialUse,
    Trialing { end: NaiveDateTime },
    TrialEnded { end: NaiveDateTime },
}

pub async fn check_license<R: Runtime>(app_handle: &AppHandle<R>) -> Result<LicenseCheckStatus> {
    let activation_id = yaak_models::queries::get_key_value_string(
        app_handle,
        KV_ACTIVATION_ID_KEY,
        KV_NAMESPACE,
        "",
    )
    .await;

    // No license activations exist
    let settings = yaak_models::queries::get_or_create_settings(app_handle).await;
    let trial_end = settings.created_at.add(Duration::from_secs(TRIAL_SECONDS));

    debug!("Trial ending at {trial_end:?}");

    let has_activation_id = !activation_id.is_empty();
    let trial_period_active = Utc::now().naive_utc() < trial_end;

    match (has_activation_id, trial_period_active) {
        (false, true) => Ok(LicenseCheckStatus::Trialing { end: trial_end }),
        (false, false) => Ok(LicenseCheckStatus::TrialEnded { end: trial_end }),
        (true, _) => {
            info!("Checking license activation");
            // A license has been activated, so let's check the license server
            let client = reqwest::Client::new();
            let payload = CheckActivationRequestPayload { activation_id: activation_id.clone() };
            let response = client.post(build_url("/check")).json(&payload).send().await?;
            debug!("Activated license status={}", response.status());
            let body_text = response.text().await?;
            debug!("Activated license: {} {}", body_text, activation_id);

            let result: CheckActivationResponsePayload = serde_json::from_str(body_text.as_str())?;
            if !result.status {
                todo!("Implement error conditions on API")
            }

            Ok(LicenseCheckStatus::CommercialUse)
        }
    }
}

fn build_url(path: &str) -> String {
    if is_dev() {
        format!("http://localhost:9444/licenses{path}")
    } else {
        format!("https://license.yaak.app/licenses{path}")
    }
}
