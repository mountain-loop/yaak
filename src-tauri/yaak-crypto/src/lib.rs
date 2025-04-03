extern crate core;

use crate::commands::*;
use crate::manager::EncryptionManager;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{generate_handler, Manager, Runtime};

mod commands;
pub mod encryption;
pub mod error;
pub mod manager;
mod master_key;
mod workspace_key;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-crypto")
        .invoke_handler(generate_handler![
            enable_encryption,
            reveal_workspace_key,
            set_workspace_key
        ])
        .setup(|app, _api| {
            app.manage(EncryptionManager::new(app.app_handle()));
            Ok(())
        })
        .build()
}
