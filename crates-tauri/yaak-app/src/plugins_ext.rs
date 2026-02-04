//! Tauri-specific plugin management code.
//!
//! This module contains all Tauri integration for the plugin system:
//! - Plugin initialization and lifecycle management
//! - Tauri commands for plugin search/install/uninstall
//! - Plugin update checking

use crate::PluginContextExt;
use crate::error::Result;
use crate::models_ext::QueryManagerExt;
use log::{error, info, warn};
use serde::Serialize;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::path::BaseDirectory;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, Runtime, State, WebviewWindow, WindowEvent, command,
    is_dev,
};
use tokio::sync::Mutex;
use ts_rs::TS;
use yaak_models::models::Plugin;
use yaak_models::util::UpdateSource;
use yaak_plugins::api::{
    PluginNameVersion, PluginSearchResponse, PluginUpdatesResponse, check_plugin_updates,
    search_plugins,
};
use yaak_plugins::events::{Color, Icon, PluginContext, ShowToastRequest};
use yaak_plugins::install::{delete_and_uninstall, download_and_install};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::plugin_meta::get_plugin_meta;
use yaak_tauri_utils::api_client::yaak_api_client;

static EXITING: AtomicBool = AtomicBool::new(false);

// ============================================================================
// Plugin Updater
// ============================================================================

const MAX_UPDATE_CHECK_HOURS: u64 = 12;

pub struct PluginUpdater {
    last_check: Option<Instant>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "index.ts")]
pub struct PluginUpdateNotification {
    pub update_count: usize,
    pub plugins: Vec<PluginUpdateInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "index.ts")]
pub struct PluginUpdateInfo {
    pub name: String,
    pub current_version: String,
    pub latest_version: String,
}

impl PluginUpdater {
    pub fn new() -> Self {
        Self { last_check: None }
    }

    pub async fn check_now<R: Runtime>(&mut self, window: &WebviewWindow<R>) -> Result<bool> {
        self.last_check = Some(Instant::now());

        info!("Checking for plugin updates");

        let http_client = yaak_api_client(window.app_handle())?;
        let plugins = window.app_handle().db().list_plugins()?;
        let updates = check_plugin_updates(&http_client, plugins.clone()).await?;

        if updates.plugins.is_empty() {
            info!("No plugin updates available");
            return Ok(false);
        }

        // Get current plugin versions to build notification
        let mut update_infos = Vec::new();

        for update in &updates.plugins {
            if let Some(plugin) = plugins.iter().find(|p| {
                if let Ok(meta) = get_plugin_meta(&std::path::Path::new(&p.directory)) {
                    meta.name == update.name
                } else {
                    false
                }
            }) {
                if let Ok(meta) = get_plugin_meta(&std::path::Path::new(&plugin.directory)) {
                    update_infos.push(PluginUpdateInfo {
                        name: update.name.clone(),
                        current_version: meta.version,
                        latest_version: update.version.clone(),
                    });
                }
            }
        }

        let notification =
            PluginUpdateNotification { update_count: update_infos.len(), plugins: update_infos };

        info!("Found {} plugin update(s)", notification.update_count);

        if let Err(e) = window.emit_to(window.label(), "plugin_updates_available", &notification) {
            error!("Failed to emit plugin_updates_available event: {}", e);
        }

        Ok(true)
    }

    pub async fn maybe_check<R: Runtime>(&mut self, window: &WebviewWindow<R>) -> Result<bool> {
        let update_period_seconds = MAX_UPDATE_CHECK_HOURS * 60 * 60;

        if let Some(i) = self.last_check
            && i.elapsed().as_secs() < update_period_seconds
        {
            return Ok(false);
        }

        self.check_now(window).await
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[command]
pub async fn cmd_plugins_search<R: Runtime>(
    app_handle: AppHandle<R>,
    query: &str,
) -> Result<PluginSearchResponse> {
    let http_client = yaak_api_client(&app_handle)?;
    Ok(search_plugins(&http_client, query).await?)
}

#[command]
pub async fn cmd_plugins_install<R: Runtime>(
    window: WebviewWindow<R>,
    name: &str,
    version: Option<String>,
) -> Result<()> {
    let plugin_manager = Arc::new((*window.state::<PluginManager>()).clone());
    let http_client = yaak_api_client(window.app_handle())?;
    let query_manager = window.state::<yaak_models::query_manager::QueryManager>();
    let plugin_context = window.plugin_context();
    download_and_install(
        plugin_manager,
        &query_manager,
        &http_client,
        &plugin_context,
        name,
        version,
    )
    .await?;
    Ok(())
}

#[command]
pub async fn cmd_plugins_uninstall<R: Runtime>(
    plugin_id: &str,
    window: WebviewWindow<R>,
) -> Result<Plugin> {
    let plugin_manager = Arc::new((*window.state::<PluginManager>()).clone());
    let query_manager = window.state::<yaak_models::query_manager::QueryManager>();
    let plugin_context = window.plugin_context();
    Ok(delete_and_uninstall(plugin_manager, &query_manager, &plugin_context, plugin_id).await?)
}

#[command]
pub async fn cmd_plugins_updates<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<PluginUpdatesResponse> {
    let http_client = yaak_api_client(&app_handle)?;
    let plugins = app_handle.db().list_plugins()?;
    Ok(check_plugin_updates(&http_client, plugins).await?)
}

#[command]
pub async fn cmd_plugins_update_all<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<Vec<PluginNameVersion>> {
    let http_client = yaak_api_client(window.app_handle())?;
    let plugins = window.db().list_plugins()?;

    // Get list of available updates (already filtered to only registry plugins)
    let updates = check_plugin_updates(&http_client, plugins).await?;

    if updates.plugins.is_empty() {
        return Ok(Vec::new());
    }

    let plugin_manager = Arc::new((*window.state::<PluginManager>()).clone());
    let query_manager = window.state::<yaak_models::query_manager::QueryManager>();
    let plugin_context = window.plugin_context();

    let mut updated = Vec::new();

    for update in updates.plugins {
        info!("Updating plugin: {} to version {}", update.name, update.version);
        match download_and_install(
            plugin_manager.clone(),
            &query_manager,
            &http_client,
            &plugin_context,
            &update.name,
            Some(update.version.clone()),
        )
        .await
        {
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

// ============================================================================
// Tauri Plugin Initialization
// ============================================================================

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-plugins")
        .setup(|app_handle, _| {
            // Resolve paths for plugin manager
            let vendored_plugin_dir = app_handle
                .path()
                .resolve("vendored/plugins", BaseDirectory::Resource)
                .expect("failed to resolve plugin directory resource");

            let installed_plugin_dir = app_handle
                .path()
                .app_data_dir()
                .expect("failed to get app data dir")
                .join("installed-plugins");

            #[cfg(target_os = "windows")]
            let node_bin_name = "yaaknode.exe";
            #[cfg(not(target_os = "windows"))]
            let node_bin_name = "yaaknode";

            let node_bin_path = app_handle
                .path()
                .resolve(format!("vendored/node/{}", node_bin_name), BaseDirectory::Resource)
                .expect("failed to resolve yaaknode binary");

            let plugin_runtime_main = app_handle
                .path()
                .resolve("vendored/plugin-runtime", BaseDirectory::Resource)
                .expect("failed to resolve plugin runtime")
                .join("index.cjs");

            let dev_mode = is_dev();

            // Create plugin manager asynchronously
            let app_handle_clone = app_handle.clone();
            tauri::async_runtime::block_on(async move {
                let manager = PluginManager::new(
                    vendored_plugin_dir,
                    installed_plugin_dir,
                    node_bin_path,
                    plugin_runtime_main,
                    dev_mode,
                )
                .await;

                // Initialize all plugins after manager is created
                let bundled_dirs = manager
                    .list_bundled_plugin_dirs()
                    .await
                    .expect("Failed to list bundled plugins");

                // Ensure all bundled plugins make it into the database
                let db = app_handle_clone.db();
                for dir in &bundled_dirs {
                    if db.get_plugin_by_directory(dir).is_none() {
                        db.upsert_plugin(
                            &Plugin {
                                directory: dir.clone(),
                                enabled: true,
                                url: None,
                                ..Default::default()
                            },
                            &UpdateSource::Background,
                        )
                        .expect("Failed to upsert bundled plugin");
                    }
                }

                // Get all plugins from database and initialize
                let plugins = db.list_plugins().expect("Failed to list plugins from database");
                drop(db); // Explicitly drop the connection before await

                let errors =
                    manager.initialize_all_plugins(plugins, &PluginContext::new_empty()).await;

                // Show toast for any failed plugins
                for (plugin_dir, error_msg) in errors {
                    let plugin_name = plugin_dir.split('/').last().unwrap_or(&plugin_dir);
                    let toast = ShowToastRequest {
                        message: format!("Failed to start plugin '{}': {}", plugin_name, error_msg),
                        color: Some(Color::Danger),
                        icon: Some(Icon::AlertTriangle),
                        timeout: Some(10000),
                    };
                    if let Err(emit_err) = app_handle_clone.emit("show_toast", toast) {
                        error!("Failed to emit toast for plugin error: {emit_err:?}");
                    }
                }

                app_handle_clone.manage(manager);
            });

            let plugin_updater = PluginUpdater::new();
            app_handle.manage(Mutex::new(plugin_updater));

            Ok(())
        })
        .on_event(|app, e| match e {
            RunEvent::ExitRequested { api, .. } => {
                if EXITING.swap(true, Ordering::SeqCst) {
                    return; // Only exit once to prevent infinite recursion
                }
                api.prevent_exit();
                tauri::async_runtime::block_on(async move {
                    info!("Exiting plugin runtime due to app exit");
                    let manager: State<PluginManager> = app.state();
                    manager.terminate().await;
                    app.exit(0);
                });
            }
            RunEvent::WindowEvent { event: WindowEvent::Focused(true), label, .. } => {
                // Check for plugin updates on window focus
                let w = app.get_webview_window(&label).unwrap();
                let h = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    let val: State<'_, Mutex<PluginUpdater>> = h.state();
                    if let Err(e) = val.lock().await.maybe_check(&w).await {
                        warn!("Failed to check for plugin updates {e:?}");
                    }
                });
            }
            _ => {}
        })
        .build()
}
