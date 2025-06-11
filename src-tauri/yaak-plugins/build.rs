const COMMANDS: &[&str] = &["search", "install"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
