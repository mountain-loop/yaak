use crate::commands::{add, checkout, commit, initialize, log, pull, push, status, unstage};
use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod commands;
mod error;
mod git;
mod push;
mod repository;
mod util;
mod branch;
mod pull;
mod callbacks;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-git")
        .invoke_handler(generate_handler![
            add, checkout, commit, initialize, log, pull, push, status, unstage
        ])
        .build()
}
