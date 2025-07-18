use crate::api::{
    check_plugin_updates, search_plugins, PluginSearchResponse, PluginUpdatesResponse,
};
use crate::error::Result;
use crate::install::{delete_and_uninstall, download_and_install};
use tauri::{command, AppHandle, Runtime, WebviewWindow};
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
