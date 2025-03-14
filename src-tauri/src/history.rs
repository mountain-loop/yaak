use tauri::{Manager, Runtime, WebviewWindow};

use yaak_models::queries::{
    get_key_value_int, get_key_value_string,
    set_key_value_int, set_key_value_string, UpdateSource,
};

const NAMESPACE: &str = "analytics";
const NUM_LAUNCHES_KEY: &str = "num_launches";

#[derive(Default, Debug)]
pub struct LaunchEventInfo {
    pub current_version: String,
    pub previous_version: String,
    pub launched_after_update: bool,
    pub num_launches: i32,
}

pub async fn store_launch_history<R: Runtime>(w: &WebviewWindow<R>) -> LaunchEventInfo {
    let last_tracked_version_key = "last_tracked_version";

    let mut info = LaunchEventInfo::default();

    info.num_launches = get_num_launches(w).await + 1;
    info.previous_version = get_key_value_string(w, NAMESPACE, last_tracked_version_key, "").await;
    info.current_version = w.package_info().version.to_string();

    if info.previous_version.is_empty() {
    } else {
        info.launched_after_update = info.current_version != info.previous_version;
    };

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

pub async fn get_num_launches<R: Runtime>(w: &WebviewWindow<R>) -> i32 {
    get_key_value_int(w, NAMESPACE, NUM_LAUNCHES_KEY, 0).await
}
