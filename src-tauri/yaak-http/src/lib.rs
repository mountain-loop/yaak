use crate::manager::HttpConnectionManager;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

pub mod client;
pub mod dns;
pub mod error;
pub mod manager;
pub mod path_placeholders;
pub mod sender;
pub mod transaction;
pub mod types;
mod proto;
mod chained_reader;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-http")
        .setup(|app, _api| {
            let manager = HttpConnectionManager::new();
            app.manage(manager);
            Ok(())
        })
        .build()
}
