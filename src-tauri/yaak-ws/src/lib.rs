mod commands;
mod connect;
mod error;
mod manager;
mod render;

use crate::commands::{
    connect, close, delete_connection, delete_connections, delete_request, duplicate_request,
    list_connections, list_events, list_requests, send, upsert_request,
};
use crate::manager::WebsocketManager;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{generate_handler, Manager, Runtime};
use tokio::sync::Mutex;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("yaak-ws")
        .invoke_handler(generate_handler![
            connect,
            close,
            delete_connection,
            delete_connections,
            delete_request,
            duplicate_request,
            list_connections,
            list_events,
            list_requests,
            send,
            upsert_request,
        ])
        .setup(|app, _api| {
            let manager = WebsocketManager::new();
            app.manage(Mutex::new(manager));

            Ok(())
        })
        .build()
}
