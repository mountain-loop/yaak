use crate::commands::{apply, calculate, calculate_fs, watch};
use tauri::{
    Runtime, generate_handler,
    plugin::{Builder, TauriPlugin},
};

mod commands;
pub mod error;
pub mod models;
mod sync;
mod watch;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-sync")
        .invoke_handler(generate_handler![calculate, calculate_fs, apply, watch])
        .build()
}
