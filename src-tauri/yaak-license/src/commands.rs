use crate::errors::Result;
use crate::{activate_license, check_license, ActivateLicenseRequestPayload, LicenseCheckStatus};
use log::{debug, info};
use std::string::ToString;
use tauri::{command, AppHandle, Manager, Runtime, WebviewWindow};

#[command]
pub async fn check<R: Runtime>(app_handle: AppHandle<R>) -> Result<LicenseCheckStatus> {
    debug!("Checking license");
    check_license(&app_handle).await
}

#[command]
pub async fn activate<R: Runtime>(license_key: &str, window: WebviewWindow<R>) -> Result<()> {
    info!("Activating license {}", license_key);
    activate_license(
        &window,
        ActivateLicenseRequestPayload {
            license_key: license_key.to_string(),
            app_platform: get_os().to_string(),
            app_version: window.app_handle().package_info().version.to_string(),
        },
    )
    .await
}

fn get_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}
