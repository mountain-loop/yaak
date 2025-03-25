use crate::error::Error::{ClientError, ServerError};
use crate::error::Result;
use chrono::{NaiveDateTime, Utc};
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::ops::Add;
use std::time::Duration;
use tauri::{is_dev, AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use ts_rs::TS;
use yaak_models::manager::QueryManagerExt;
use yaak_models::queries_legacy::UpdateSource;

const KV_NAMESPACE: &str = "license";
const KV_ACTIVATION_ID_KEY: &str = "activation_id";
const TRIAL_SECONDS: u64 = 3600 * 24 * 30;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct CheckActivationRequestPayload {
    pub app_version: String,
    pub app_platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "license.ts")]
pub struct CheckActivationResponsePayload {
    pub active: bool,
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
pub struct DeactivateLicenseRequestPayload {
    pub app_version: String,
    pub app_platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "license.ts")]
pub struct ActivateLicenseResponsePayload {
    pub activation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "license.ts")]
pub struct APIErrorResponsePayload {
    pub error: String,
    pub message: String,
}

pub async fn activate_license<R: Runtime>(
    window: &WebviewWindow<R>,
    p: ActivateLicenseRequestPayload,
) -> Result<()> {
    let client = reqwest::Client::new();
    let response = client.post(build_url("/licenses/activate")).json(&p).send().await?;

    if response.status().is_client_error() {
        let body: APIErrorResponsePayload = response.json().await?;
        return Err(ClientError {
            message: body.message,
            error: body.error,
        });
    }

    if response.status().is_server_error() {
        return Err(ServerError);
    }

    let body: ActivateLicenseResponsePayload = response.json().await?;
    window.app_handle().queries().connect().await?.set_key_value_string(
        KV_ACTIVATION_ID_KEY,
        KV_NAMESPACE,
        body.activation_id.as_str(),
        &UpdateSource::from_window(&window),
    );

    if let Err(e) = window.emit("license-activated", true) {
        warn!("Failed to emit check-license event: {}", e);
    }

    Ok(())
}

pub async fn deactivate_license<R: Runtime>(
    window: &WebviewWindow<R>,
    p: DeactivateLicenseRequestPayload,
) -> Result<()> {
    let app_handle = window.app_handle();
    let activation_id = get_activation_id(app_handle).await;

    let client = reqwest::Client::new();
    let path = format!("/licenses/activations/{}/deactivate", activation_id);
    let response = client.post(build_url(&path)).json(&p).send().await?;

    if response.status().is_client_error() {
        let body: APIErrorResponsePayload = response.json().await?;
        return Err(ClientError {
            message: body.message,
            error: body.error,
        });
    }

    if response.status().is_server_error() {
        return Err(ServerError);
    }

    app_handle.queries().connect().await?.delete_key_value(
        KV_ACTIVATION_ID_KEY,
        KV_NAMESPACE,
        &UpdateSource::from_window(&window),
    )?;

    if let Err(e) = app_handle.emit("license-deactivated", true) {
        warn!("Failed to emit deactivate-license event: {}", e);
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "license.ts")]
pub enum LicenseCheckStatus {
    PersonalUse { trial_ended: NaiveDateTime },
    CommercialUse,
    InvalidLicense,
    Trialing { end: NaiveDateTime },
}

pub async fn check_license<R: Runtime>(
    window: &WebviewWindow<R>,
    payload: CheckActivationRequestPayload,
) -> Result<LicenseCheckStatus> {
    let activation_id = get_activation_id(window.app_handle()).await;
    let settings = window
        .queries()
        .connect()
        .await?
        .get_or_create_settings(&UpdateSource::from_window(window))?;
    let trial_end = settings.created_at.add(Duration::from_secs(TRIAL_SECONDS));

    debug!("Trial ending at {trial_end:?}");

    let has_activation_id = !activation_id.is_empty();
    let trial_period_active = Utc::now().naive_utc() < trial_end;

    match (has_activation_id, trial_period_active) {
        (false, true) => Ok(LicenseCheckStatus::Trialing { end: trial_end }),
        (false, false) => Ok(LicenseCheckStatus::PersonalUse {
            trial_ended: trial_end,
        }),
        (true, _) => {
            info!("Checking license activation");
            // A license has been activated, so let's check the license server
            let client = reqwest::Client::new();
            let path = format!("/licenses/activations/{activation_id}/check");
            let response = client.post(build_url(&path)).json(&payload).send().await?;

            if response.status().is_client_error() {
                let body: APIErrorResponsePayload = response.json().await?;
                return Err(ClientError {
                    message: body.message,
                    error: body.error,
                });
            }

            if response.status().is_server_error() {
                return Err(ServerError);
            }

            let body: CheckActivationResponsePayload = response.json().await?;
            if !body.active {
                return Ok(LicenseCheckStatus::InvalidLicense);
            }

            Ok(LicenseCheckStatus::CommercialUse)
        }
    }
}

fn build_url(path: &str) -> String {
    if is_dev() {
        format!("http://localhost:9444{path}")
    } else {
        format!("https://license.yaak.app{path}")
    }
}

pub async fn get_activation_id<R: Runtime>(app_handle: &AppHandle<R>) -> String {
    app_handle.queries().connect().await.unwrap().get_key_value_string(
        KV_ACTIVATION_ID_KEY,
        KV_NAMESPACE,
        "",
    )
}
