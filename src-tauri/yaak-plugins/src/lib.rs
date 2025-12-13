use crate::commands::{install, search, uninstall, updates};
use crate::manager::PluginManager;
use log::info;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, RunEvent, Runtime, State, generate_handler};

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
mod server_ws;
pub mod template_callback;
mod util;

static EXITING: AtomicBool = AtomicBool::new(false);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-plugins")
        .invoke_handler(generate_handler![search, install, uninstall, updates])
        .setup(|app_handle, _| {
            let manager = PluginManager::new(app_handle.clone());
            app_handle.manage(manager.clone());
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
            _ => {}
        })
        .build()
}
