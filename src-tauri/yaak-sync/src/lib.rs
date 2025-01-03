use crate::commands::{apply, calculate};
use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod commands;
mod error;
mod models;
mod sync;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-sync").invoke_handler(generate_handler![calculate, apply]).build()
}
