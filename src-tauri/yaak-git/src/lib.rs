use crate::commands::{add, add_credential, branch, checkout, commit, delete_branch, fetch_all, initialize, log, merge_branch, pull, push, status, unstage};
use tauri::{
    Runtime, generate_handler,
    plugin::{Builder, TauriPlugin},
};

mod add;
mod binary;
mod branch;
mod callbacks;
mod commands;
mod commit;
mod fetch;
mod init;
mod log;
mod merge;
mod pull;
mod push;
mod repository;
mod status;
mod unstage;
mod util;
pub mod error;
mod credential;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-git")
        .invoke_handler(generate_handler![
            add,
            add_credential,
            branch,
            checkout,
            commit,
            delete_branch,
            fetch_all,
            initialize,
            log,
            merge_branch,
            pull,
            push,
            status,
            unstage,
        ])
        .build()
}
