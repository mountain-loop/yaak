const COMMANDS: &[&str] = &[
    "upsert",
    "delete",
    "workspace_models",
    "grpc_events",
    "websocket_events",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
