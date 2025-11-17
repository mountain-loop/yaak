use crate::commands::{add, add_credential, add_remote, branch, checkout, commit, delete_branch, fetch_all, initialize, log, merge_branch, pull, push, remotes, rm_remote, status, unstage};
use tauri::{
    Runtime, generate_handler,
    plugin::{Builder, TauriPlugin},
};

mod add;
mod binary;
mod branch;
mod commands;
mod commit;
mod credential;
mod fetch;
mod init;
mod log;
mod merge;
mod pull;
mod push;
mod remotes;
mod repository;
mod status;
mod unstage;
mod util;
pub mod error;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-git")
        .invoke_handler(generate_handler![
            add,
            add_credential,
            add_remote,
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
            remotes,
            rm_remote,
            status,
            unstage,
        ])
        .build()
}
