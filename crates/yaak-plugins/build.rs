const COMMANDS: &[&str] = &["search", "install", "updates", "uninstall", "update_all"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
