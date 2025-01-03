const COMMANDS: &[&str] = &["calculate", "apply"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
