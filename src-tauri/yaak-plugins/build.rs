const COMMANDS: &[&str] = &["search", "install", "updates", "uninstall"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
