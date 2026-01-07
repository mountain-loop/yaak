//! Tauri extension traits for yaak-plugins.
//! These are temporary until all crates are refactored to not use Tauri.

use tauri::{Manager, Runtime, State};
use yaak_crypto::manager::EncryptionManager;
use yaak_models::db_context::DbContext;
use yaak_models::query_manager::QueryManager;

/// Extension trait for accessing the QueryManager from Tauri Manager types.
pub trait QueryManagerExt<'a, R> {
    fn db(&'a self) -> DbContext<'a>;
}

impl<'a, R: Runtime, M: Manager<R>> QueryManagerExt<'a, R> for M {
    fn db(&'a self) -> DbContext<'a> {
        let qm = self.state::<QueryManager>();
        qm.inner().connect()
    }
}

/// Extension trait for accessing the EncryptionManager from Tauri Manager types.
pub trait EncryptionManagerExt<'a, R> {
    fn crypto(&'a self) -> State<'a, EncryptionManager>;
}

impl<'a, R: Runtime, M: Manager<R>> EncryptionManagerExt<'a, R> for M {
    fn crypto(&'a self) -> State<'a, EncryptionManager> {
        self.state::<EncryptionManager>()
    }
}
