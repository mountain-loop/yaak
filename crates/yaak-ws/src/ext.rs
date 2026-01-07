//! Tauri extension traits for yaak-ws.
//! These are temporary until all crates are refactored to not use Tauri.

use tauri::{Manager, Runtime, State};
use yaak_models::db_context::DbContext;
use yaak_models::query_manager::QueryManager;

/// Extension trait for accessing the QueryManager from Tauri Manager types.
pub(crate) trait QueryManagerExt<'a, R> {
    fn db(&'a self) -> DbContext<'a>;
}

impl<'a, R: Runtime, M: Manager<R>> QueryManagerExt<'a, R> for M {
    fn db(&'a self) -> DbContext<'a> {
        let qm = self.state::<QueryManager>();
        qm.inner().connect()
    }
}
