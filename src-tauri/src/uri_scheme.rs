use crate::error::Result;
use crate::import::import_data;
use log::{info, warn};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, Runtime, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use yaak_plugins::events::{Color, ShowToastRequest};
use yaak_plugins::install::download_and_install;

pub(crate) async fn handle_deep_link<R: Runtime>(
    app_handle: &AppHandle<R>,
    url: &Url,
) -> Result<()> {
    let command = url.domain().unwrap_or_default();
    info!("Yaak URI scheme invoked {}?{}", command, url.query().unwrap_or_default());

    let query_map: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let windows = app_handle.webview_windows();
    let (_, window) = windows.iter().next().unwrap();

    match command {
        "install-plugin" => {
            let name = query_map.get("name").unwrap();
            let version = query_map.get("version").cloned();
            _ = window.set_focus();
            let confirmed_install = app_handle
                .dialog()
                .message(format!("Install plugin {name} {version:?}?",))
                .kind(MessageDialogKind::Info)
                .buttons(MessageDialogButtons::OkCustom("Install".to_string()))
                .blocking_show();
            if !confirmed_install {
                // Cancelled installation
                return Ok(());
            }

            let pv = download_and_install(window, name, version).await?;
            app_handle.emit(
                "show_toast",
                ShowToastRequest {
                    message: format!("Installed {name}@{}", pv.version),
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
