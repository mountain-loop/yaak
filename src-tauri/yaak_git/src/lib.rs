use crate::commands::{add, checkout, commit, initialize, log, status, sync, unstage};
use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Runtime,
};
use crate::fs_sync::{watch_deleted_models, watch_upserted_models};

mod commands;
mod error;
mod fs_sync;
mod git;
mod model_hash;
mod models;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-git")
        .invoke_handler(generate_handler![
            add, checkout, commit, initialize, log, status, sync, unstage,
        ])
        .setup(|app_handle, _| {
            watch_upserted_models(app_handle);
            watch_deleted_models(app_handle);
            Ok(())
        })
        .build()
}
