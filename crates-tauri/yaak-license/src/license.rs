//! Mocked license module for a self-built fork (Yaak source is MIT).
//!
//! No network calls and no database access. `check_license` always reports an
//! active license. The types are unchanged so the ts-rs generated TypeScript
//! bindings (license.ts / gen_models.ts) keep the same shape.

use crate::error::Result;
use chrono::{DateTime, Duration, Utc};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, WebviewWindow};
use ts_rs::TS;

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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "status", content = "data")]
#[ts(export, export_to = "license.ts")]
pub enum LicenseCheckStatus {
    // Local Types
    PersonalUse {
        trial_ended: DateTime<Utc>,
    },
    Trialing {
        end: DateTime<Utc>,
    },
    Error {
        message: String,
        code: String,
    },

    // Server Types
    Active {
        #[serde(rename = "periodEnd")]
        period_end: DateTime<Utc>,
        #[serde(rename = "cancelAt")]
        cancel_at: Option<DateTime<Utc>>,
    },
    Inactive {
        status: String,
    },
    Expired {
        changes: i32,
        #[serde(rename = "changesUrl")]
        changes_url: Option<String>,
        #[serde(rename = "billingUrl")]
        billing_url: String,
        #[serde(rename = "periodEnd")]
        period_end: DateTime<Utc>,
    },
    PastDue {
        #[serde(rename = "billingUrl")]
        billing_url: String,
        #[serde(rename = "periodEnd")]
        period_end: DateTime<Utc>,
    },
}

/// Mock: accepts any key, stores nothing, contacts no server.
pub async fn activate_license<R: Runtime>(
    window: &WebviewWindow<R>,
    _license_key: &str,
) -> Result<()> {
    info!("Mock license: activate (no-op)");
    if let Err(e) = window.emit("license-activated", true) {
        warn!("Failed to emit license-activated event: {}", e);
    }
    Ok(())
}

/// Mock: no-op, contacts no server.
pub async fn deactivate_license<R: Runtime>(window: &WebviewWindow<R>) -> Result<()> {
    info!("Mock license: deactivate (no-op)");
    if let Err(e) = window.emit("license-deactivated", true) {
        warn!("Failed to emit license-deactivated event: {}", e);
    }
    Ok(())
}

/// Mock: always reports an active license ten years out.
pub async fn check_license<R: Runtime>(_window: &WebviewWindow<R>) -> Result<LicenseCheckStatus> {
    Ok(LicenseCheckStatus::Active {
        period_end: Utc::now() + Duration::days(3650),
        cancel_at: None,
    })
}

/// Mock: returns a fixed placeholder ID so callers see an "activated" state.
pub async fn get_activation_id<R: Runtime>(_app_handle: &AppHandle<R>) -> String {
    "mock-activation".to_string()
}
