const COMMANDS: &[&str] = &[
    "delete",
    "duplicate",
    "get_settings",
    "grpc_events",
    "upsert",
    "websocket_events",
    "workspace_models",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
