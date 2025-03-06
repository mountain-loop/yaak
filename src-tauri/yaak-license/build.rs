const COMMANDS: &[&str] = &["activate", "deactivate", "check"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
