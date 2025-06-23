use crate::api::{
    PluginSearchResponse, PluginUpdatesResponse, PluginVersion, check_plugin_updates,
    search_plugins,
};
use crate::error::Result;
use crate::install::download_and_install;
use tauri::{AppHandle, Runtime, WebviewWindow, command};

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
    plugin: PluginVersion,
) -> Result<String> {
    download_and_install(&window, &plugin).await
}

#[command]
pub(crate) async fn updates<R: Runtime>(app_handle: AppHandle<R>) -> Result<PluginUpdatesResponse> {
    check_plugin_updates(&app_handle).await
}
