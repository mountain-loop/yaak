use crate::error::Result;
use crate::{LicenseCheckStatus, activate_license, check_license, deactivate_license};
use log::{debug, info};
use tauri::{Runtime, WebviewWindow, command};

#[command]
pub async fn check<R: Runtime>(window: WebviewWindow<R>) -> Result<LicenseCheckStatus> {
    debug!("Checking license");
    check_license(&window).await
}

#[command]
pub async fn activate<R: Runtime>(license_key: &str, window: WebviewWindow<R>) -> Result<()> {
    info!("Activating license {}", license_key);
    activate_license(&window, license_key).await
}

#[command]
pub async fn deactivate<R: Runtime>(window: WebviewWindow<R>) -> Result<()> {
    info!("Deactivating activation");
    deactivate_license(&window).await
}
