use log::{debug, warn};
use serde::Serialize;
use tauri::{AppHandle, Runtime, is_dev};
use yaak_api::{ApiClientKind, yaak_api_client};
use yaak_common::platform::get_os_str;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FeedbackPayload {
    feature: String,
    text: String,
    app_version: String,
    os: String,
}

/// Send explicit user feedback for a feature. Fire-and-forget: errors are
/// logged and swallowed so a failed send never surfaces to the user.
pub async fn send_feedback<R: Runtime>(app_handle: &AppHandle<R>, feature: String, text: String) {
    let app_version = app_handle.package_info().version.to_string();
    let payload = FeedbackPayload {
        feature,
        text,
        app_version: app_version.clone(),
        os: get_os_str().to_string(),
    };

    let client = match yaak_api_client(ApiClientKind::App, &app_version) {
        Ok(c) => c,
        Err(e) => {
            debug!("Failed to build feedback client: {e:?}");
            return;
        }
    };

    let url = build_url("/app-feedback");
    debug!(
        "Sending feature feedback to {url}: feature={}, app_version={}, os={}, text_len={}",
        payload.feature,
        payload.app_version,
        payload.os,
        payload.text.len()
    );

    match client.post(&url).json(&payload).send().await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                debug!("Sent feature feedback with status {status}");
            } else {
                let body = resp
                    .text()
                    .await
                    .unwrap_or_else(|e| format!("<failed to read response body: {e:?}>"));
                warn!("Failed to send feature feedback with status {status}: {body}");
            }
        }
        Err(e) => warn!("Failed to send feature feedback: {e:?}"),
    }
}

fn build_url(path: &str) -> String {
    if is_dev() {
        format!("http://localhost:9444/api/v1{path}")
    } else {
        format!("https://api.yaak.app/api/v1{path}")
    }
}
