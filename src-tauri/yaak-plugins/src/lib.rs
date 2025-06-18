use crate::commands::{install, search};
use crate::manager::PluginManager;
use log::info;
use std::process::exit;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, RunEvent, Runtime, State, generate_handler};

mod commands;
pub mod error;
pub mod events;
pub mod manager;
pub mod native_template_functions;
mod nodejs;
pub mod plugin_handle;
mod server_ws;
pub mod template_callback;
mod util;
mod checksum;
pub mod api;
pub mod install;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-plugins")
        .invoke_handler(generate_handler![search, install])
        .setup(|app_handle, _| {
            let manager = PluginManager::new(app_handle.clone());
            app_handle.manage(manager.clone());
            Ok(())
        })
        .on_event(|app, e| match e {
            // TODO: Also exit when app is force-quit (eg. cmd+r in IntelliJ runner)
            RunEvent::ExitRequested { api, .. } => {
                api.prevent_exit();
                tauri::async_runtime::block_on(async move {
                    info!("Exiting plugin runtime due to app exit");
                    let manager: State<PluginManager> = app.state();
                    manager.terminate().await;
                    exit(0);
                });
            }
            _ => {}
        })
        .build()
}
