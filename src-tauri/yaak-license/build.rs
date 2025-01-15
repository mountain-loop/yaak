const COMMANDS: &[&str] = &["activate", "check"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
