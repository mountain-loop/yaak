//! Mocked license module for a self-built fork (Yaak source is MIT).
//!
//! The activation ID is stored in the same KV row the real code uses
//! (namespace "license", key "activation_id"), but the check is answered
//! locally. Nothing talks to license.yaak.app. The types are unchanged so the
//! ts-rs generated TypeScript bindings keep the same shape.

use crate::error::Result;
use chrono::{DateTime, Duration, Utc};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use ts_rs::TS;
use yaak_models::client_db::{ClientDb, WriteDb};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;

/// Extension trait for accessing the QueryManager from Tauri Manager types.
/// This is needed temporarily until all crates are refactored to not use Tauri.
trait QueryManagerExt<'a, R> {
    fn db(&'a self) -> ClientDb<'a>;
    fn with_tx<T>(
        &'a self,
        func: impl FnOnce(&WriteDb) -> yaak_models::error::Result<T>,
    ) -> yaak_models::error::Result<T>;
}

impl<'a, R: Runtime, M: Manager<R>> QueryManagerExt<'a, R> for M {
    fn db(&'a self) -> ClientDb<'a> {
        let qm = self.state::<QueryManager>();
        qm.inner().connect()
    }

    fn with_tx<T>(
        &'a self,
        func: impl FnOnce(&WriteDb) -> yaak_models::error::Result<T>,
    ) -> yaak_models::error::Result<T> {
        let qm = self.state::<QueryManager>();
        qm.inner().with_tx(func)
    }
}

const KV_NAMESPACE: &str = "license";
const KV_ACTIVATION_ID_KEY: &str = "activation_id";
const MOCK_ACTIVATION_ID: &str = "local-activation";

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

/// Writes the activation ID into the KV store, as the real activation does.
fn store_activation<R: Runtime>(window: &WebviewWindow<R>) {
    if let Err(e) = window.app_handle().with_tx(|tx| {
        tx.set_key_value_str(
            KV_ACTIVATION_ID_KEY,
            KV_NAMESPACE,
            MOCK_ACTIVATION_ID,
            &UpdateSource::from_window_label(window.label()),
        );
        Ok(())
    }) {
        warn!("Failed to store license activation: {e}");
    }
}

/// Mock: accepts any key and records an activation locally. No network.
pub async fn activate_license<R: Runtime>(
    window: &WebviewWindow<R>,
    _license_key: &str,
) -> Result<()> {
    info!("Mock license: activate");
    store_activation(window);

    if let Err(e) = window.emit("license-activated", true) {
        warn!("Failed to emit license-activated event: {}", e);
    }

    Ok(())
}

/// Mock: removes the stored activation. No network.
pub async fn deactivate_license<R: Runtime>(window: &WebviewWindow<R>) -> Result<()> {
    info!("Mock license: deactivate");
    let app_handle = window.app_handle();

    app_handle.with_tx(|tx| {
        tx.delete_key_value(
            KV_ACTIVATION_ID_KEY,
            KV_NAMESPACE,
            &UpdateSource::from_window_label(window.label()),
        )
    })?;

    if let Err(e) = app_handle.emit("license-deactivated", true) {
        warn!("Failed to emit license-deactivated event: {}", e);
    }

    Ok(())
}

/// Mock: if no activation is stored yet, writes one, then reports Active.
/// (A later deactivate is undone by the next check. To make deactivate stick,
/// delete the seeding block below and activate once from the settings dialog.)
pub async fn check_license<R: Runtime>(window: &WebviewWindow<R>) -> Result<LicenseCheckStatus> {
    if get_activation_id(window.app_handle()).await.is_empty() {
        store_activation(window);
    }

    Ok(LicenseCheckStatus::Active {
        period_end: Utc::now() + Duration::days(3650),
        cancel_at: None,
    })
}

pub async fn get_activation_id<R: Runtime>(app_handle: &AppHandle<R>) -> String {
    app_handle.db().get_key_value_str(KV_ACTIVATION_ID_KEY, KV_NAMESPACE, "")
}
