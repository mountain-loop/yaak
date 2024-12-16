use crate::commands::{add, checkout, commit, initialize, log, status, unstage};
use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod commands;
mod error;
mod git;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-git")
        .invoke_handler(generate_handler![add, checkout, commit, initialize, log, status, unstage])
        .build()
}
