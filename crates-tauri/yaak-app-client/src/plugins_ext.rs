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
    AppHandle, Emitter, Manager, RunEvent, Runtime, State, WebviewWindow, WindowEvent,
    is_dev,
};
use tokio::sync::Mutex;
use ts_rs::TS;
use yaak_api::{ApiClientKind, yaak_api_client};
use yaak_models::models::{Plugin, PluginSource};
use yaak_models::util::UpdateSource;
use yaak_plugins::api::{
    PluginNameVersion, PluginSearchResponse, PluginUpdatesResponse, check_plugin_updates,
    search_plugins,
};
use yaak_plugins::events::{Color, PluginContext, ShowToastRequest};
use yaak_plugins::install::{delete_and_uninstall, download_and_install};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::error::Error::PluginErr;
use yaak_plugins::plugin_meta::get_plugin_meta;

static EXITING: AtomicBool = AtomicBool::new(false);

// ============================================================================
// Plugin Manager Handle
// ============================================================================

/// The plugin runtime boots in the background so startup doesn't wait on it.
/// This handle is the only way to reach the manager: [`PluginManagerHandle::get`]
/// resolves once boot completes, so callers can never observe a
/// partially-initialized runtime.
#[derive(Clone)]
pub struct PluginManagerHandle {
    rx: tokio::sync::watch::Receiver<Option<std::result::Result<PluginManager, String>>>,
}

impl PluginManagerHandle {
    pub async fn get(&self) -> yaak_plugins::error::Result<PluginManager> {
        let mut rx = self.rx.clone();
        let result = rx
            .wait_for(|v| v.is_some())
            .await
            .map_err(|_| PluginErr("Plugin runtime boot task died".to_string()))?;
        result.clone().unwrap().map_err(PluginErr)
    }
}

/// Wait for the plugin runtime to finish booting and return the manager.
pub async fn plugin_manager<R: Runtime>(
    manager: &impl Manager<R>,
) -> yaak_plugins::error::Result<PluginManager> {
    let handle = manager.state::<PluginManagerHandle>().inner().clone();
    handle.get().await
}

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

        let app_version = window.app_handle().package_info().version.to_string();
        let http_client = yaak_api_client(ApiClientKind::App, &app_version)?;
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

pub async fn cmd_plugins_search<R: Runtime>(
    app_handle: AppHandle<R>,
    query: &str,
) -> Result<PluginSearchResponse> {
    let app_version = app_handle.package_info().version.to_string();
    let http_client = yaak_api_client(ApiClientKind::App, &app_version)?;
    Ok(search_plugins(&http_client, query).await?)
}

pub async fn cmd_plugins_install<R: Runtime>(
    window: WebviewWindow<R>,
    name: &str,
    version: Option<String>,
) -> Result<()> {
    let plugin_manager = Arc::new(plugin_manager(&window).await?);
    let app_version = window.app_handle().package_info().version.to_string();
    let http_client = yaak_api_client(ApiClientKind::App, &app_version)?;
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

pub async fn cmd_plugins_install_from_directory<R: Runtime>(
    window: WebviewWindow<R>,
    directory: &str,
) -> Result<Plugin> {
    // Resolve the manager before writing the row so startup's plugin snapshot
    // can't include it and boot it a second time
    let plugin_manager = Arc::new(plugin_manager(&window).await?);
    let plugin = window.db().upsert_plugin(
        &Plugin {
            directory: directory.into(),
            url: None,
            enabled: true,
            source: PluginSource::Filesystem,
            ..Default::default()
        },
        &UpdateSource::from_window_label(window.label()),
    )?;

    plugin_manager.add_plugin(&window.plugin_context(), &plugin).await?;

    Ok(plugin)
}

pub async fn cmd_plugins_uninstall<R: Runtime>(
    plugin_id: &str,
    window: WebviewWindow<R>,
) -> Result<Plugin> {
    let plugin_manager = Arc::new(plugin_manager(&window).await?);
    let query_manager = window.state::<yaak_models::query_manager::QueryManager>();
    let plugin_context = window.plugin_context();
    Ok(delete_and_uninstall(plugin_manager, &query_manager, &plugin_context, plugin_id).await?)
}

pub async fn cmd_plugins_updates<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<PluginUpdatesResponse> {
    let app_version = app_handle.package_info().version.to_string();
    let http_client = yaak_api_client(ApiClientKind::App, &app_version)?;
    let plugins = app_handle.db().list_plugins()?;
    Ok(check_plugin_updates(&http_client, plugins).await?)
}

pub async fn cmd_plugins_update_all<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<Vec<PluginNameVersion>> {
    let app_version = window.app_handle().package_info().version.to_string();
    let http_client = yaak_api_client(ApiClientKind::App, &app_version)?;
    let plugins = window.db().list_plugins()?;

    // Get list of available updates (already filtered to only registry plugins)
    let updates = check_plugin_updates(&http_client, plugins).await?;

    if updates.plugins.is_empty() {
        return Ok(Vec::new());
    }

    let plugin_manager = Arc::new(plugin_manager(&window).await?);
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

            // In dev, spawn yaaknode from the source vendored dir, not the copy under
            // target/. tauri-build rewrites the target copy in place when the source
            // changes (e.g. a Node version bump between branches), and on macOS an
            // in-place write permanently taints the inode's cached code signature —
            // every later spawn of it dies with SIGKILL (Code Signature Invalid).
            // vendor-node.cjs always recreates the source file on a fresh inode.
            #[cfg(debug_assertions)]
            let node_bin_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("vendored")
                .join("node")
                .join(node_bin_name);

            #[cfg(not(debug_assertions))]
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
            let query_manager =
                app_handle.state::<yaak_models::query_manager::QueryManager>().inner().clone();

            // Boot the plugin runtime in the background so the window shows
            // immediately. Everything that needs plugins resolves the handle,
            // which waits for this task to finish.
            let (tx, rx) = tokio::sync::watch::channel(None);
            app_handle.manage(PluginManagerHandle { rx });
            let app_handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let result = tokio::time::timeout(
                    Duration::from_secs(60),
                    PluginManager::new(
                        vendored_plugin_dir,
                        installed_plugin_dir,
                        node_bin_path,
                        plugin_runtime_main,
                        &query_manager,
                        &PluginContext::new_empty(),
                        dev_mode,
                    ),
                )
                .await
                .unwrap_or_else(|_| Err(yaak_plugins::error::Error::PluginErr(
                    "Timed out starting the plugin runtime".to_string(),
                )));

                let manager = match result {
                    Ok(manager) => manager,
                    Err(e) => {
                        error!("Failed to start plugin runtime: {e:?}");
                        let _ = tx.send(Some(Err(e.to_string())));
                        return;
                    }
                };

                // Surface unexpected runtime crashes to the user
                let mut crash_rx = manager.runtime_crash_rx();
                let app_handle_crash = app_handle_clone.clone();
                tauri::async_runtime::spawn(async move {
                    if crash_rx.wait_for(|status| status.is_some()).await.is_ok() {
                        let status = crash_rx.borrow().clone().unwrap_or_default();
                        // The crash may happen during startup, before any window or
                        // frontend listener exists — wait so the toast isn't lost
                        while app_handle_crash.webview_windows().is_empty() {
                            tokio::time::sleep(Duration::from_millis(500)).await;
                        }
                        tokio::time::sleep(Duration::from_secs(3)).await;
                        let _ = app_handle_crash.emit(
                            "show_toast",
                            ShowToastRequest {
                                message: format!("Plugin runtime crashed ({status})"),
                                color: Some(Color::Danger),
                                icon: None,
                                timeout: None,
                            },
                        );
                    }
                });

                let _ = tx.send(Some(Ok(manager)));
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
                    // Bound the wait in case the exit comes while boot is still
                    // in flight
                    let get_manager = plugin_manager(app);
                    if let Ok(Ok(manager)) =
                        tokio::time::timeout(Duration::from_secs(5), get_manager).await
                    {
                        manager.terminate().await;
                    }
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
