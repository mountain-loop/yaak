const COMMANDS: &[&str] = &["upsert", "delete", "workspace_models"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
