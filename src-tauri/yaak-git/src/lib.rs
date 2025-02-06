use crate::commands::{add, branch, checkout, commit, delete_branch, initialize, log, merge_branch, pull, push, status, unstage};
use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod branch;
mod callbacks;
mod commands;
mod error;
mod git;
mod merge;
mod pull;
mod push;
mod repository;
mod util;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-git")
        .invoke_handler(generate_handler![
            add,
            branch,
            checkout,
            commit,
            delete_branch,
            initialize,
            log,
            merge_branch,
            pull,
            push,
            status,
            unstage
        ])
        .build()
}
