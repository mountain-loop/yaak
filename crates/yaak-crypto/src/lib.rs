extern crate core;

use crate::commands::*;
use crate::manager::EncryptionManager;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{generate_handler, Manager, Runtime, State};
use yaak_models::query_manager::QueryManager;

mod commands;
pub mod encryption;
pub mod error;
pub mod manager;
mod master_key;
mod workspace_key;

/// Extension trait for accessing the EncryptionManager from Tauri Manager types.
pub trait EncryptionManagerExt<'a, R> {
    fn crypto(&'a self) -> State<'a, EncryptionManager>;
}

impl<'a, R: Runtime, M: Manager<R>> EncryptionManagerExt<'a, R> for M {
    fn crypto(&'a self) -> State<'a, EncryptionManager> {
        self.state::<EncryptionManager>()
    }
}

/// Extension trait for accessing the QueryManager from Tauri Manager types.
/// This is needed temporarily until all crates are refactored to not use Tauri.
trait QueryManagerExt<'a, R> {
    fn db_manager(&'a self) -> State<'a, QueryManager>;
}

impl<'a, R: Runtime, M: Manager<R>> QueryManagerExt<'a, R> for M {
    fn db_manager(&'a self) -> State<'a, QueryManager> {
        self.state::<QueryManager>()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-crypto")
        .invoke_handler(generate_handler![
            enable_encryption,
            reveal_workspace_key,
            set_workspace_key
        ])
        .setup(|app, _api| {
            let query_manager = app.db_manager().inner().clone();
            let app_id = app.config().identifier.to_string();
            app.manage(EncryptionManager::new(query_manager, app_id));
            Ok(())
        })
        .build()
}
