const COMMANDS: &[&str] = &["list"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
