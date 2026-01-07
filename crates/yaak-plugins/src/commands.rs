use crate::api::{
    PluginNameVersion, PluginSearchResponse, PluginUpdatesResponse, check_plugin_updates,
    search_plugins,
};
use crate::error::Result;
use crate::install::{delete_and_uninstall, download_and_install};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow, command};
use yaak_models::models::Plugin;

#[command]
pub(crate) async fn search<R: Runtime>(
    app_handle: AppHandle<R>,
    query: &str,
) -> Result<PluginSearchResponse> {
    search_plugins(&app_handle, query).await
}

#[command]
pub(crate) async fn install<R: Runtime>(
    window: WebviewWindow<R>,
    name: &str,
    version: Option<String>,
) -> Result<()> {
    download_and_install(&window, name, version).await?;
    Ok(())
}

#[command]
pub(crate) async fn uninstall<R: Runtime>(
    plugin_id: &str,
    window: WebviewWindow<R>,
) -> Result<Plugin> {
    delete_and_uninstall(&window, plugin_id).await
}

#[command]
pub(crate) async fn updates<R: Runtime>(app_handle: AppHandle<R>) -> Result<PluginUpdatesResponse> {
    check_plugin_updates(&app_handle).await
}

#[command]
pub(crate) async fn update_all<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<Vec<PluginNameVersion>> {
    use log::info;

    // Get list of available updates (already filtered to only registry plugins)
    let updates = check_plugin_updates(&window.app_handle()).await?;

    if updates.plugins.is_empty() {
        return Ok(Vec::new());
    }

    let mut updated = Vec::new();

    for update in updates.plugins {
        info!("Updating plugin: {} to version {}", update.name, update.version);
        match download_and_install(&window, &update.name, Some(update.version.clone())).await {
            Ok(_) => {
                info!("Successfully updated plugin: {}", update.name);
                updated.push(update.clone());
            }
            Err(e) => {
                log::error!("Failed to update plugin {}: {:?}", update.name, e);
            }
        }
    }

    Ok(updated)
}
