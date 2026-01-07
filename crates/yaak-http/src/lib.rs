use crate::manager::HttpConnectionManager;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

mod chained_reader;
pub mod client;
pub mod cookies;
pub mod decompress;
pub mod dns;
pub mod error;
pub mod manager;
pub mod path_placeholders;
mod proto;
pub mod sender;
pub mod tee_reader;
pub mod transaction;
pub mod types;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-http")
        .setup(|app, _api| {
            let manager = HttpConnectionManager::new();
            app.manage(manager);
            Ok(())
        })
        .build()
}
