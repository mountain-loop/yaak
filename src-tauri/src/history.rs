use tauri::{AppHandle, Runtime};
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::UpdateSource;

const NAMESPACE: &str = "analytics";
const NUM_LAUNCHES_KEY: &str = "num_launches";

#[derive(Default, Debug)]
pub struct LaunchEventInfo {
    pub current_version: String,
    pub previous_version: String,
    pub launched_after_update: bool,
    pub num_launches: i32,
}

pub async fn store_launch_history<R: Runtime>(app_handle: &AppHandle<R>) -> LaunchEventInfo {
    let last_tracked_version_key = "last_tracked_version";

    let mut info = LaunchEventInfo::default();

    info.num_launches = get_num_launches(app_handle).await + 1;
    info.current_version = app_handle.package_info().version.to_string();

    app_handle
        .with_tx(|tx| {
            info.previous_version =
                tx.get_key_value_string(NAMESPACE, last_tracked_version_key, "");

            if !info.previous_version.is_empty() {
                info.launched_after_update = info.current_version != info.previous_version;
            };

            // Update key values

            let source = &UpdateSource::Background;
            let version = info.current_version.as_str();
            tx.set_key_value_string(NAMESPACE, last_tracked_version_key, version, source);
            tx.set_key_value_int(NAMESPACE, NUM_LAUNCHES_KEY, info.num_launches, source);
            Ok(())
        })
        .unwrap();

    info
}

pub async fn get_num_launches<R: Runtime>(app_handle: &AppHandle<R>) -> i32 {
    app_handle.db().get_key_value_int(NAMESPACE, NUM_LAUNCHES_KEY, 0)
}
