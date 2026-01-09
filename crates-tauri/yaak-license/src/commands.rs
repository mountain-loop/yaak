use crate::error::Result;
use crate::{LicenseCheckStatus, activate_license, check_license, deactivate_license};
use tauri::{Runtime, WebviewWindow, command};

#[command]
pub async fn check<R: Runtime>(window: WebviewWindow<R>) -> Result<LicenseCheckStatus> {
    check_license(&window).await
}

#[command]
pub async fn activate<R: Runtime>(license_key: &str, window: WebviewWindow<R>) -> Result<()> {
    activate_license(&window, license_key).await
}

#[command]
pub async fn deactivate<R: Runtime>(window: WebviewWindow<R>) -> Result<()> {
    deactivate_license(&window).await
}
