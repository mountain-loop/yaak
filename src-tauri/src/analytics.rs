use std::fmt::Display;

use log::{debug, info};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Manager, Runtime, WebviewWindow};
use ts_rs::TS;
use yaak_models::queries::{
    generate_id, get_key_value_int, get_key_value_string, get_or_create_settings,
    set_key_value_int, set_key_value_string, UpdateSource,
};

use crate::is_dev;

const NAMESPACE: &str = "analytics";
const NUM_LAUNCHES_KEY: &str = "num_launches";

// serializable
#[derive(Serialize, Deserialize, Debug, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "analytics.ts")]
pub enum AnalyticsResource {
    App,
    Appearance,
    Button,
    Checkbox,
    CookieJar,
    Dialog,
    Environment,
    Folder,
    GrpcConnection,
    GrpcEvent,
    GrpcRequest,
    HttpRequest,
    HttpResponse,
    KeyValue,
    Link,
    Mutation,
    Plugin,
    Select,
    Setting,
    Sidebar,
    Tab,
    Theme,
    Workspace,
}

impl AnalyticsResource {
    pub fn from_str(s: &str) -> serde_json::Result<AnalyticsResource> {
        serde_json::from_str(format!("\"{s}\"").as_str())
    }
}

impl Display for AnalyticsResource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", serde_json::to_string(self).unwrap().replace("\"", ""))
    }
}

#[derive(Serialize, Deserialize, Debug, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "analytics.ts")]
pub enum AnalyticsAction {
    Cancel,
    Click,
    Commit,
    Create,
    Delete,
    DeleteMany,
    Duplicate,
    Error,
    Export,
    Hide,
    Import,
    Launch,
    LaunchFirst,
    LaunchUpdate,
    Send,
    Show,
    Toggle,
    Update,
    Upsert,
}

impl AnalyticsAction {
    pub fn from_str(s: &str) -> serde_json::Result<AnalyticsAction> {
        serde_json::from_str(format!("\"{s}\"").as_str())
    }
}

impl Display for AnalyticsAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", serde_json::to_string(self).unwrap().replace("\"", ""))
    }
}

#[derive(Default, Debug)]
pub struct LaunchEventInfo {
    pub current_version: String,
    pub previous_version: String,
    pub launched_after_update: bool,
    pub num_launches: i32,
}

pub async fn track_launch_event<R: Runtime>(w: &WebviewWindow<R>) -> LaunchEventInfo {
    let last_tracked_version_key = "last_tracked_version";

    let mut info = LaunchEventInfo::default();

    info.num_launches = get_num_launches(w).await + 1;
    info.previous_version = get_key_value_string(w, NAMESPACE, last_tracked_version_key, "").await;
    info.current_version = w.package_info().version.to_string();

    if info.previous_version.is_empty() {
        track_event(w, AnalyticsResource::App, AnalyticsAction::LaunchFirst, None).await;
    } else {
        info.launched_after_update = info.current_version != info.previous_version;
        if info.launched_after_update {
            track_event(
                w,
                AnalyticsResource::App,
                AnalyticsAction::LaunchUpdate,
                Some(json!({ NUM_LAUNCHES_KEY: info.num_launches })),
            )
            .await;
        }
    };

    // Track a launch event in all cases
    track_event(
        w,
        AnalyticsResource::App,
        AnalyticsAction::Launch,
        Some(json!({ NUM_LAUNCHES_KEY: info.num_launches })),
    )
    .await;

    // Update key values

    set_key_value_string(
        w,
        NAMESPACE,
        last_tracked_version_key,
        info.current_version.as_str(),
        &UpdateSource::Background,
    )
    .await;
    set_key_value_int(w, NAMESPACE, NUM_LAUNCHES_KEY, info.num_launches, &UpdateSource::Background)
        .await;

    info
}

pub async fn track_event<R: Runtime>(
    w: &WebviewWindow<R>,
    resource: AnalyticsResource,
    action: AnalyticsAction,
    attributes: Option<Value>,
) {
    let id = get_id(w).await;
    let event = format!("{}.{}", resource, action);
    let attributes_json = attributes.unwrap_or("{}".to_string().into()).to_string();
    let info = w.app_handle().package_info();
    let tz = datetime::sys_timezone().unwrap_or("unknown".to_string());
    let site = match is_dev() {
        true => "site_TkHWjoXwZPq3HfhERb",
        false => "site_zOK0d7jeBy2TLxFCnZ",
    };
    let base_url = match is_dev() {
        true => "http://localhost:7194",
        false => "https://t.yaak.app",
    };
    let params = vec![
        ("u", id),
        ("e", event.clone()),
        ("a", attributes_json.clone()),
        ("id", site.to_string()),
        ("v", info.version.clone().to_string()),
        ("os", get_os().to_string()),
        ("tz", tz),
        ("xy", get_window_size(w)),
    ];
    let req =
        reqwest::Client::builder().build().unwrap().get(format!("{base_url}/t/e")).query(&params);

    let settings = get_or_create_settings(w).await;
    if !settings.telemetry {
        info!("Track event (disabled): {}", event);
        return;
    }

    // Disable analytics actual sending in dev
    if is_dev() {
        debug!("Track event: {} {}", event, attributes_json);
        return;
    }

    if let Err(e) = req.send().await {
        info!("Error sending analytics event: {}", e);
    }
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

fn get_window_size<R: Runtime>(w: &WebviewWindow<R>) -> String {
    let current_monitor = match w.current_monitor() {
        Ok(Some(m)) => m,
        _ => return "unknown".to_string(),
    };

    let scale_factor = current_monitor.scale_factor();
    let size = current_monitor.size();
    let width: f64 = size.width as f64 / scale_factor;
    let height: f64 = size.height as f64 / scale_factor;

    format!("{}x{}", (width / 100.0).round() * 100.0, (height / 100.0).round() * 100.0)
}

async fn get_id<R: Runtime>(w: &WebviewWindow<R>) -> String {
    let id = get_key_value_string(w, "analytics", "id", "").await;
    if id.is_empty() {
        let new_id = generate_id();
        set_key_value_string(w, "analytics", "id", new_id.as_str(), &UpdateSource::Background)
            .await;
        new_id
    } else {
        id
    }
}

pub async fn get_num_launches<R: Runtime>(w: &WebviewWindow<R>) -> i32 {
    get_key_value_int(w, NAMESPACE, NUM_LAUNCHES_KEY, 0).await
}
