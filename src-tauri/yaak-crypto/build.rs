const COMMANDS: &[&str] = &["enable_encryption"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
