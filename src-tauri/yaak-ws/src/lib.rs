mod cmd;
mod connect;
mod error;
mod render;

use crate::cmd::{connect, list_connections, list_requests, upsert_request};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{generate_handler, Runtime};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-ws")
        .invoke_handler(generate_handler![upsert_request, list_requests, list_connections, connect])
        .build()
}
