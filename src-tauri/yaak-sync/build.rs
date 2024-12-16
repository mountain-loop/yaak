const COMMANDS: &[&str] = &["sync"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
