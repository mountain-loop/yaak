use crate::commands::sync;
use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod commands;
mod error;
mod sync;
mod models;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-sync").invoke_handler(generate_handler![sync]).build()
}
