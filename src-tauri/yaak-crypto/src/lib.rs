extern crate core;

use crate::manager::EncryptionManager;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{generate_handler, Manager, Runtime};

pub mod encryption;
pub mod error;
pub mod manager;
mod master_key;
mod workspace_key;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-crypto")
        .invoke_handler(generate_handler![])
        .setup(|app, _api| {
            app.manage(EncryptionManager::new(app.app_handle()));
            Ok(())
        })
        .build()
}
