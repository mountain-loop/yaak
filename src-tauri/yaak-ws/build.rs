use tauri_plugin;
const COMMANDS: &[&str] = &[
    "cancel",
    "connect",
    "delete_request",
    "list_connections",
    "list_requests",
    "upsert_request",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
