use crate::error::Result;
use crate::import::import_data;
use log::{info, warn};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, Runtime, Url};
use yaak_plugins::api::get_plugin;
use yaak_plugins::events::{Color, ShowToastRequest};
use yaak_plugins::install::download_and_install;

pub(crate) async fn handle_deep_link<R: Runtime>(
    app_handle: &AppHandle<R>,
    url: &Url,
) -> Result<()> {
    info!("Yaak URI scheme invoked with {url:?}");

    let command = url.domain().unwrap_or_default();
    let query_map: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let windows = app_handle.webview_windows();
    let (_, window) = windows.iter().next().unwrap();

    match command {
        "install-plugin" => {
            let url = query_map.get("url").unwrap();
            let plugin_version = get_plugin(&url, None).await?;
            download_and_install(window, &plugin_version).await?;
            _ = window.set_focus();
            app_handle.emit(
                "show_toast",
                ShowToastRequest {
                    message: format!("Installed {}@{}", plugin_version.id, plugin_version.version),
                    color: Some(Color::Success),
                    icon: None,
                },
            )?;
        }
        "import-data" => {
            let file_path = query_map.get("path").unwrap();
            let results = import_data(window, file_path).await?;
            _ = window.set_focus();
            window.emit(
                "show_toast",
                ShowToastRequest {
                    message: format!("Imported data for {} workspaces", results.workspaces.len()),
                    color: Some(Color::Success),
                    icon: None,
                },
            )?;
        }
        _ => {
            warn!("Unknown deep link command: {command}");
        }
    }

    Ok(())
}
