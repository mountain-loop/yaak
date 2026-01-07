use crate::commands::{install, search, uninstall, update_all, updates};
use crate::manager::PluginManager;
use crate::plugin_updater::PluginUpdater;
use log::{info, warn};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, RunEvent, Runtime, State, WindowEvent, generate_handler};
use tokio::sync::Mutex;

pub mod api;
mod checksum;
mod commands;
pub mod error;
pub mod events;
pub mod install;
pub mod manager;
pub mod native_template_functions;
mod nodejs;
pub mod plugin_handle;
pub mod plugin_meta;
pub mod plugin_updater;
mod server_ws;
pub mod template_callback;
mod util;

static EXITING: AtomicBool = AtomicBool::new(false);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-plugins")
        .invoke_handler(generate_handler![search, install, uninstall, updates, update_all])
        .setup(|app_handle, _| {
            let manager = PluginManager::new(app_handle.clone());
            app_handle.manage(manager.clone());

            let plugin_updater = PluginUpdater::new();
            app_handle.manage(Mutex::new(plugin_updater));

            Ok(())
        })
        .on_event(|app, e| match e {
            // TODO: Also exit when app is force-quit (eg. cmd+r in IntelliJ runner)
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
                    tokio::time::sleep(Duration::from_secs(3)).await; // Wait a bit so it's not so jarring
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
