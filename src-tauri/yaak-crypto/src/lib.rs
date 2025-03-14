use crate::manager::EncryptionManager;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{generate_handler, Manager, Runtime};
use tokio::sync::Mutex;

pub mod encryption;
pub mod error;
pub mod manager;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-crypto")
        .invoke_handler(generate_handler![])
        .setup(|app, _api| {
            let manager = EncryptionManager::new(app.app_handle());
            app.manage(Mutex::new(manager));
            Ok(())
        })
        .build()
}
