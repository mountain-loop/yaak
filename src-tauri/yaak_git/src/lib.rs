use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Runtime,
};
use crate::commands::{checkout, commit, status};

mod commands;
mod errors;
mod git;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-git").invoke_handler(generate_handler![commit, status, checkout]).build()
}
