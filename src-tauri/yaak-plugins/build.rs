const COMMANDS: &[&str] = &["search", "install", "updates"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
