const COMMANDS: &[&str] = &["set_title", "set_theme"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
