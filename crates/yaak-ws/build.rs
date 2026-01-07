use tauri_plugin;
const COMMANDS: &[&str] = &[
    "connect",
    "close",
    "delete_connection",
    "delete_connections",
    "delete_request",
    "duplicate_request",
    "list_connections",
    "list_events",
    "list_requests",
    "send",
    "upsert_request",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
