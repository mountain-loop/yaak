use tauri_plugin;
const COMMANDS: &[&str] = &[
    "connect",
    "list_connections",
    "list_requests",
    "upsert_request",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
