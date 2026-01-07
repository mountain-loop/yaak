use chrono::{NaiveDateTime, Utc};
use log::debug;
use std::sync::OnceLock;
use tauri::{AppHandle, Runtime};
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::UpdateSource;

const NAMESPACE: &str = "analytics";
const NUM_LAUNCHES_KEY: &str = "num_launches";
const LAST_VERSION_KEY: &str = "last_tracked_version";
const PREV_VERSION_KEY: &str = "last_tracked_version_prev";
const VERSION_SINCE_KEY: &str = "last_tracked_version_since";

#[derive(Default, Debug, Clone)]
pub struct LaunchEventInfo {
    pub current_version: String,
    pub previous_version: String,
    pub launched_after_update: bool,
    pub version_since: NaiveDateTime,
    pub user_since: NaiveDateTime,
    pub num_launches: i32,
}

static LAUNCH_INFO: OnceLock<LaunchEventInfo> = OnceLock::new();

pub fn get_or_upsert_launch_info<R: Runtime>(app_handle: &AppHandle<R>) -> &LaunchEventInfo {
    LAUNCH_INFO.get_or_init(|| {
        let now = Utc::now().naive_utc();
        let mut info = LaunchEventInfo {
            version_since: app_handle.db().get_key_value_dte(NAMESPACE, VERSION_SINCE_KEY, now),
            current_version: app_handle.package_info().version.to_string(),
            user_since: app_handle.db().get_settings().created_at,
            num_launches: app_handle.db().get_key_value_int(NAMESPACE, NUM_LAUNCHES_KEY, 0) + 1,

            // The rest will be set below
            ..Default::default()
        };

        app_handle
            .with_tx(|tx| {
                // Load the previously tracked version
                let curr_db = tx.get_key_value_str(NAMESPACE, LAST_VERSION_KEY, "");
                let prev_db = tx.get_key_value_str(NAMESPACE, PREV_VERSION_KEY, "");

                // We just updated if the app version is different from the last tracked version we stored
                if !curr_db.is_empty() && info.current_version != curr_db {
                    info.launched_after_update = true;
                }

                // If we just updated, track the previous version as the "previous" current version
                if info.launched_after_update {
                    info.previous_version = curr_db.clone();
                    info.version_since = now;
                } else {
                    info.previous_version = prev_db.clone();
                }

                // Rotate stored versions: move previous into the "prev" slot before overwriting
                let source = &UpdateSource::Background;

                tx.set_key_value_str(NAMESPACE, PREV_VERSION_KEY, &info.previous_version, source);
                tx.set_key_value_str(NAMESPACE, LAST_VERSION_KEY, &info.current_version, source);
                tx.set_key_value_dte(NAMESPACE, VERSION_SINCE_KEY, info.version_since, source);
                tx.set_key_value_int(NAMESPACE, NUM_LAUNCHES_KEY, info.num_launches, source);

                Ok(())
            })
            .unwrap();

        debug!("Initialized launch info");

        info
    })
}
