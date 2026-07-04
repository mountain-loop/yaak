use log::debug;
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

    match client.post(build_url("/app-feedback")).json(&payload).send().await {
        Ok(resp) => debug!("Sent feedback with status {}", resp.status()),
        Err(e) => debug!("Failed to send feedback: {e:?}"),
    }
}

fn build_url(path: &str) -> String {
    if is_dev() {
        format!("http://localhost:9444/api/v1{path}")
    } else {
        format!("https://api.yaak.app/api/v1{path}")
    }
}
