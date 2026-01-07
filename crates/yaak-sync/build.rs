const COMMANDS: &[&str] = &["calculate", "calculate_fs", "apply", "watch"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
