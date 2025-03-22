const COMMANDS: &[&str] = &["upsert", "delete"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
