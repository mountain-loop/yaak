const COMMANDS: &[&str] = &["status", "commit", "checkout"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
