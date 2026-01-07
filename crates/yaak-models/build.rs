const COMMANDS: &[&str] = &[
    "delete",
    "duplicate",
    "get_graphql_introspection",
    "get_settings",
    "grpc_events",
    "upsert",
    "upsert_graphql_introspection",
    "websocket_events",
    "workspace_models",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
