use crate::manager::HttpConnectionManager;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

pub mod tls;
pub mod path_placeholders;
pub mod error;
pub mod manager;
pub mod dns;
pub mod client;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-http")
        .setup(|app, _api| {
            let manager = HttpConnectionManager::new();
            app.manage(manager);
            Ok(())
        })
        .build()
}
