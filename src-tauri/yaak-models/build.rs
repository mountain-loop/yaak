const COMMANDS: &[&str] = &[
    "delete",
    "duplicate",
    "grpc_events",
    "upsert",
    "websocket_events",
    "workspace_models",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
