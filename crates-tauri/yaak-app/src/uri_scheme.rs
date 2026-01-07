use crate::error::Result;
use crate::import::import_data;
use log::{info, warn};
use std::collections::HashMap;
use std::fs;
use tauri::{AppHandle, Emitter, Manager, Runtime, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use yaak_common::api_client::yaak_api_client;
use yaak_models::util::generate_id;
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
                .message(format!("Install plugin {name} {version:?}?"))
                .kind(MessageDialogKind::Info)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Install".to_string(),
                    "Cancel".to_string(),
                ))
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
                    timeout: Some(5000),
                },
            )?;
        }
        "import-data" => {
            let mut file_path = query_map.get("path").map(|s| s.to_owned());
            let name = query_map.get("name").map(|s| s.to_owned()).unwrap_or("data".to_string());
            _ = window.set_focus();

            if let Some(file_url) = query_map.get("url") {
                let confirmed_import = app_handle
                    .dialog()
                    .message(format!("Import {name} from {file_url}?"))
                    .kind(MessageDialogKind::Info)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Import".to_string(),
                        "Cancel".to_string(),
                    ))
                    .blocking_show();
                if !confirmed_import {
                    return Ok(());
                }

                let resp = yaak_api_client(app_handle)?.get(file_url).send().await?;
                let json = resp.bytes().await?;
                let p = app_handle
                    .path()
                    .temp_dir()?
                    .join(format!("import-{}", generate_id()))
                    .to_string_lossy()
                    .to_string();
                fs::write(&p, json)?;
                file_path = Some(p);
            }

            let file_path = match file_path {
                Some(p) => p,
                None => {
                    app_handle.emit(
                        "show_toast",
                        ShowToastRequest {
                            message: "Failed to import data".to_string(),
                            color: Some(Color::Danger),
                            icon: None,
                            timeout: None,
                        },
                    )?;
                    return Ok(());
                }
            };

            let results = import_data(window, &file_path).await?;
            window.emit(
                "show_toast",
                ShowToastRequest {
                    message: format!("Imported data for {} workspaces", results.workspaces.len()),
                    color: Some(Color::Success),
                    icon: None,
                    timeout: Some(5000),
                },
            )?;
        }
        _ => {
            warn!("Unknown deep link command: {command}");
        }
    }

    Ok(())
}
